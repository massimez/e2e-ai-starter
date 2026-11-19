import path from "node:path";
import { db } from "@workspace/db";
import {
	organizationStorageLimits,
	storageFolders,
	uploads,
} from "@workspace/db/schema";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	inArray,
	type SQL,
	sql,
} from "drizzle-orm";
import { env } from "../../env";
import { AppError, NotFoundError, ValidationError } from "../../lib/errors";
import { logError } from "../../lib/logger";
import {
	formatBytes,
	generateStorageKey,
	isAllowedContentType,
	isValidFileSize,
} from "../../lib/storage";
import { withOrg } from "../../lib/tenant";
import { STORAGE_CONFIG } from "./config";
import {
	deleteS3Object,
	ensureDevBucketExists,
	getS3ObjectStream,
	hasConfiguredS3Credentials,
	headS3Object,
	isS3NotFoundError,
	presignGetObject,
	presignPutObject,
} from "./s3";
import type {
	CommitUploadsInput,
	ListUploadsQuery,
	PresignUploadInput,
} from "./schema";

const SAFE_INLINE_IMAGE_TYPES = new Set([
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
	"image/gif",
]);

function resolveFilePresentation(
	fileKey: string,
	rawContentType: string | null
) {
	const contentType = rawContentType ?? "application/octet-stream";
	const isInline = SAFE_INLINE_IMAGE_TYPES.has(contentType);
	const fileName = path.posix.basename(fileKey) || "download";
	return {
		contentType,
		disposition: isInline ? "inline" : "attachment",
		downloadDisposition: isInline
			? `inline; filename="${fileName}"`
			: `attachment; filename="${fileName}"`,
	};
}

export function getPrivateFileProxyUrl(uploadId: string): string {
	return `/api/storage/files/${uploadId}`;
}

export function escapeIlikePattern(value: string): string {
	return value.replace(/[\\%_]/gu, "\\$&");
}

async function assertWithinStorageQuota(
	organizationId: string,
	additionalBytes: number,
	executor: Pick<typeof db, "select"> = db
): Promise<void> {
	const now = new Date();
	const [limitRow, pendingRow] = await Promise.all([
		executor
			.select()
			.from(organizationStorageLimits)
			.where(eq(organizationStorageLimits.organizationId, organizationId))
			.limit(1),
		executor
			.select({
				reservedBytes: sql<number>`COALESCE(SUM(${uploads.size}), 0)`,
			})
			.from(uploads)
			.where(
				and(
					eq(uploads.organizationId, organizationId),
					eq(uploads.status, "pending"),
					gt(uploads.expiresAt, now)
				)
			),
	]);

	const [limit] = limitRow;
	const storageLimit = limit?.storageLimit ?? STORAGE_CONFIG.BYTES_PER_GB;
	const currentUsage = limit?.currentUsage ?? 0;
	const pendingReserved = Number(pendingRow[0]?.reservedBytes ?? 0);

	if (currentUsage + pendingReserved + additionalBytes > storageLimit) {
		throw new ValidationError(
			`Storage quota exceeded. Used ${formatBytes(currentUsage)} (plus ${formatBytes(pendingReserved)} pending) of ${formatBytes(storageLimit)}.`,
			"size"
		);
	}
}

export async function presignUpload(params: {
	input: PresignUploadInput;
	organizationId: string;
	userId: string;
}) {
	const { input, organizationId, userId } = params;

	if (!isAllowedContentType(input.contentType)) {
		throw new ValidationError(
			`Content-Type "${input.contentType}" is not permitted.`,
			"contentType"
		);
	}

	if (!isValidFileSize(input.size)) {
		throw new ValidationError(
			`File size must be a positive integer up to ${formatBytes(STORAGE_CONFIG.MAX_FILE_SIZE)}.`,
			"size"
		);
	}

	if (input.folderId) {
		const [folder] = await db
			.select({ id: storageFolders.id })
			.from(storageFolders)
			.where(
				withOrg(
					storageFolders,
					organizationId,
					eq(storageFolders.id, input.folderId)
				)
			)
			.limit(1);

		if (!folder) {
			throw new NotFoundError("Folder", "folderId");
		}
	}

	await assertWithinStorageQuota(organizationId, input.size);

	const fileKey = generateStorageKey({
		entityId: input.folderId ?? null,
		entityType: "uploads",
		fileName: input.fileName,
		organizationId,
	});

	const expiresAt = new Date(
		Date.now() + STORAGE_CONFIG.PRESIGN_EXPIRY_SECONDS * 1000
	);

	if (!hasConfiguredS3Credentials()) {
		throw new AppError(
			"Object storage credentials are not configured",
			503,
			"STORAGE_UNAVAILABLE"
		);
	}

	await ensureDevBucketExists();

	let uploadUrl: string;
	try {
		uploadUrl = await presignPutObject({
			contentLength: input.size,
			contentType: input.contentType,
			expiresIn: STORAGE_CONFIG.PRESIGN_EXPIRY_SECONDS,
			fileKey,
		});
	} catch (error) {
		logError("presignUpload:S3Signer", error, { organizationId });
		throw new AppError("Failed to generate storage upload URL", {
			cause: error,
			code: "STORAGE_UNAVAILABLE",
			statusCode: 503,
		});
	}

	const created = await db.transaction(async (tx) => {
		await tx
			.insert(organizationStorageLimits)
			.values({
				currentUsage: 0,
				organizationId,
			})
			.onConflictDoNothing({
				target: organizationStorageLimits.organizationId,
			});

		await tx
			.select({ organizationId: organizationStorageLimits.organizationId })
			.from(organizationStorageLimits)
			.where(eq(organizationStorageLimits.organizationId, organizationId))
			.for("update");

		await assertWithinStorageQuota(organizationId, input.size, tx);

		const [inserted] = await tx
			.insert(uploads)
			.values({
				bucket: env.S3_BUCKET,
				contentType: input.contentType,
				expiresAt,
				fileKey,
				folderId: input.folderId ?? null,
				metadata: input.metadata ?? {},
				organizationId,
				size: input.size,
				status: "pending",
				userId,
			})
			.returning();

		if (!inserted) {
			throw new AppError("Failed to create upload record", 500);
		}
		return inserted;
	});

	const fileUrl = getPrivateFileProxyUrl(created.id);

	return {
		expiresAt: expiresAt.toISOString(),
		fileKey,
		fileUrl,
		publicUrl: fileUrl,
		uploadId: created.id,
		url: uploadUrl,
	};
}

async function verifyUploadedObject(
	uploadRow: typeof uploads.$inferSelect
): Promise<number> {
	try {
		const head = await headS3Object({
			bucket: uploadRow.bucket,
			fileKey: uploadRow.fileKey,
		});

		const actualSize = Number(head.ContentLength ?? 0);
		if (actualSize <= 0 || actualSize > STORAGE_CONFIG.MAX_FILE_SIZE) {
			throw new ValidationError(
				`Invalid uploaded object size for ${uploadRow.fileKey}`,
				"fileKeys"
			);
		}
		if (uploadRow.size !== null && actualSize !== uploadRow.size) {
			throw new ValidationError(
				`Uploaded size (${actualSize}) does not match declared size (${uploadRow.size})`,
				"fileKeys"
			);
		}
		const actualContentType =
			head.ContentType?.split(";")[0]?.trim().toLowerCase() ?? "";
		const expectedContentType =
			uploadRow.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";

		if (!(actualContentType && isAllowedContentType(actualContentType))) {
			throw new ValidationError(
				`Uploaded Content-Type is missing or not allowed for ${uploadRow.fileKey}`,
				"contentType"
			);
		}
		if (expectedContentType && actualContentType !== expectedContentType) {
			throw new ValidationError(
				`Uploaded Content-Type (${actualContentType}) does not match declared Content-Type (${expectedContentType})`,
				"contentType"
			);
		}
		return actualSize;
	} catch (error) {
		if (error instanceof AppError) {
			throw error;
		}
		if (isS3NotFoundError(error)) {
			throw new ValidationError(
				`Object has not been uploaded to storage: ${uploadRow.fileKey}`,
				{ cause: error, field: "fileKeys" }
			);
		}
		logError("commitUploads:HeadObject", error, { fileKey: uploadRow.fileKey });
		throw new AppError("Failed to verify uploaded object", {
			cause: error,
			statusCode: 502,
		});
	}
}

export async function commitUploads(params: {
	input: CommitUploadsInput;
	organizationId: string;
}) {
	const { input, organizationId } = params;
	const uniqueKeys = Array.from(new Set(input.fileKeys));
	const now = new Date();

	// Pre-fetch outside lock to verify existence and run HeadObject checks before DB row locks
	const pendingPreview = await db
		.select()
		.from(uploads)
		.where(
			withOrg(
				uploads,
				organizationId,
				inArray(uploads.fileKey, uniqueKeys),
				eq(uploads.status, "pending")
			)
		);

	if (pendingPreview.length !== uniqueKeys.length) {
		throw new NotFoundError(
			"One or more pending uploads not found or already committed"
		);
	}

	for (const row of pendingPreview) {
		if (row.expiresAt && row.expiresAt <= now) {
			throw new ValidationError(
				`Presigned upload expired for ${row.fileKey}`,
				"fileKeys"
			);
		}
	}

	const verifiedSizes = await Promise.all(
		pendingPreview.map((row) => verifyUploadedObject(row))
	);
	const totalVerifiedBytes = verifiedSizes.reduce((sum, sz) => sum + sz, 0);

	const result = await db.transaction(async (tx) => {
		const lockedUploads = await tx
			.select()
			.from(uploads)
			.where(
				withOrg(
					uploads,
					organizationId,
					inArray(uploads.fileKey, uniqueKeys),
					eq(uploads.status, "pending"),
					gt(uploads.expiresAt, now)
				)
			)
			.orderBy(asc(uploads.id))
			.for("update");

		if (lockedUploads.length !== uniqueKeys.length) {
			throw new NotFoundError(
				"One or more pending uploads expired or were already committed"
			);
		}

		await tx
			.insert(organizationStorageLimits)
			.values({
				currentUsage: 0,
				organizationId,
			})
			.onConflictDoNothing({
				target: organizationStorageLimits.organizationId,
			});

		const [lockedLimit] = await tx
			.select()
			.from(organizationStorageLimits)
			.where(eq(organizationStorageLimits.organizationId, organizationId))
			.for("update");

		const currentUsage = lockedLimit?.currentUsage ?? 0;
		const storageLimit =
			lockedLimit?.storageLimit ?? STORAGE_CONFIG.BYTES_PER_GB;

		if (currentUsage + totalVerifiedBytes > storageLimit) {
			throw new ValidationError(
				`Storage quota exceeded. Used ${formatBytes(currentUsage)} of ${formatBytes(storageLimit)}.`,
				"size"
			);
		}

		const updatedRows = await tx
			.update(uploads)
			.set({
				status: "committed",
				updatedAt: now,
			})
			.where(
				withOrg(
					uploads,
					organizationId,
					inArray(uploads.fileKey, uniqueKeys),
					eq(uploads.status, "pending")
				)
			)
			.returning();

		if (updatedRows.length !== uniqueKeys.length) {
			throw new ValidationError(
				"Concurrent upload commit conflict",
				"fileKeys"
			);
		}

		await tx
			.update(organizationStorageLimits)
			.set({
				currentUsage: sql`${organizationStorageLimits.currentUsage} + ${totalVerifiedBytes}`,
				updatedAt: now,
			})
			.where(eq(organizationStorageLimits.organizationId, organizationId));

		return updatedRows;
	});

	return {
		committedCount: result.length,
		fileKeys: uniqueKeys,
		items: result.map((row) => ({
			fileKey: row.fileKey,
			fileUrl: getPrivateFileProxyUrl(row.id),
			id: row.id,
		})),
	};
}

export async function listUploads(params: {
	organizationId: string;
	query: ListUploadsQuery;
}) {
	const { organizationId, query } = params;
	const offset = (query.page - 1) * query.limit;

	const extraConditions: SQL[] = [];

	if (query.status) {
		extraConditions.push(eq(uploads.status, query.status));
	}
	if (query.folderId !== undefined) {
		extraConditions.push(
			query.folderId === null
				? sql`${uploads.folderId} IS NULL`
				: eq(uploads.folderId, query.folderId)
		);
	}
	if (query.search) {
		const escaped = escapeIlikePattern(query.search);
		extraConditions.push(
			sql`${uploads.fileKey} ILIKE ${`%${escaped}%`} ESCAPE '\\'`
		);
	}

	const whereClause = withOrg(uploads, organizationId, ...extraConditions);

	const [items, totalRows] = await Promise.all([
		db
			.select()
			.from(uploads)
			.where(whereClause)
			.orderBy(desc(uploads.createdAt))
			.limit(query.limit)
			.offset(offset),
		db.select({ total: count() }).from(uploads).where(whereClause),
	]);

	const total = totalRows[0]?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / query.limit));

	return {
		items: items.map((item) => {
			const fileUrl = getPrivateFileProxyUrl(item.id);
			return {
				...item,
				fileUrl,
				publicUrl: fileUrl,
			};
		}),
		pagination: {
			hasMore: query.page < totalPages,
			limit: query.limit,
			page: query.page,
			total,
			totalPages,
		},
	};
}

async function requireCommittedUpload(organizationId: string, id: string) {
	const [record] = await db
		.select()
		.from(uploads)
		.where(
			withOrg(
				uploads,
				organizationId,
				eq(uploads.id, id),
				eq(uploads.status, "committed")
			)
		)
		.limit(1);

	if (!record) {
		throw new NotFoundError("File");
	}
	return record;
}

export async function getUploadSignedDownloadUrl(params: {
	id: string;
	organizationId: string;
}) {
	const record = await requireCommittedUpload(params.organizationId, params.id);

	const { contentType, disposition } = resolveFilePresentation(
		record.fileKey,
		record.contentType
	);

	const url = await presignGetObject({
		bucket: record.bucket,
		contentDisposition: disposition,
		contentType,
		expiresIn: STORAGE_CONFIG.DOWNLOAD_URL_EXPIRY_SECONDS,
		fileKey: record.fileKey,
	});

	return {
		expiresIn: STORAGE_CONFIG.DOWNLOAD_URL_EXPIRY_SECONDS,
		url,
	};
}

export async function getUploadFileStream(params: {
	id: string;
	organizationId: string;
}) {
	const record = await requireCommittedUpload(params.organizationId, params.id);

	const { contentType, downloadDisposition } = resolveFilePresentation(
		record.fileKey,
		record.contentType
	);

	try {
		const stream = await getS3ObjectStream({
			bucket: record.bucket,
			fileKey: record.fileKey,
		});
		if (!stream) {
			throw new NotFoundError("File content");
		}
		return {
			contentType,
			disposition: downloadDisposition,
			stream,
		};
	} catch (error) {
		if (isS3NotFoundError(error)) {
			throw new NotFoundError("File", { cause: error });
		}
		logError("getUploadFileStream", error, { fileKey: record.fileKey });
		throw new AppError("Failed to retrieve file from storage", {
			cause: error,
			statusCode: 502,
		});
	}
}

function resolveDeleteFilter(params: {
	fileKey?: string;
	id?: string;
	organizationId: string;
}) {
	const { fileKey, id, organizationId } = params;
	if (id) {
		return withOrg(uploads, organizationId, eq(uploads.id, id));
	}
	if (fileKey) {
		return withOrg(uploads, organizationId, eq(uploads.fileKey, fileKey));
	}
	return null;
}

async function deleteS3ObjectWithRetry(
	bucket: string,
	fileKey: string,
	uploadId: string,
	retriesLeft = 1
): Promise<void> {
	try {
		await deleteS3Object({ bucket, fileKey });
	} catch (error) {
		if (isS3NotFoundError(error)) {
			return;
		}
		if (retriesLeft > 0) {
			await deleteS3ObjectWithRetry(bucket, fileKey, uploadId, retriesLeft - 1);
			return;
		}
		logError("deleteUpload:S3Orphan", error, {
			bucket,
			fileKey,
			uploadId,
		});
	}
}

export async function deleteUpload(params: {
	fileKey?: string;
	id?: string;
	organizationId: string;
}) {
	const { fileKey, id, organizationId } = params;

	const filter = resolveDeleteFilter({ fileKey, id, organizationId });

	if (!filter) {
		throw new ValidationError("Upload identifier is required");
	}

	const { deletedBucket, deletedFileKey, deletedId } = await db.transaction(
		async (tx) => {
			const [existing] = await tx
				.select()
				.from(uploads)
				.where(filter)
				.for("update")
				.limit(1);

			if (!existing) {
				throw new NotFoundError("File not found or unauthorized");
			}

			const [deleted] = await tx
				.delete(uploads)
				.where(withOrg(uploads, organizationId, eq(uploads.id, existing.id)))
				.returning();

			if (deleted?.size && deleted.status === "committed") {
				await tx
					.update(organizationStorageLimits)
					.set({
						currentUsage: sql`GREATEST(0, ${organizationStorageLimits.currentUsage} - ${deleted.size})`,
						updatedAt: new Date(),
					})
					.where(eq(organizationStorageLimits.organizationId, organizationId));
			}

			return {
				deletedBucket: existing.bucket,
				deletedFileKey: existing.fileKey,
				deletedId: existing.id,
			};
		}
	);

	await deleteS3ObjectWithRetry(deletedBucket, deletedFileKey, deletedId);

	return {
		fileKey: deletedFileKey,
		id: deletedId,
		success: true,
	};
}

export async function getStorageUsage(organizationId: string) {
	const [record] = await db
		.select()
		.from(organizationStorageLimits)
		.where(eq(organizationStorageLimits.organizationId, organizationId))
		.limit(1);

	const currentUsage = record?.currentUsage ?? 0;
	const storageLimit = record?.storageLimit ?? STORAGE_CONFIG.BYTES_PER_GB;
	const availableSpace = Math.max(0, storageLimit - currentUsage);
	const usagePercent =
		storageLimit > 0
			? Math.min(100, Math.round((currentUsage / storageLimit) * 100))
			: 0;

	return {
		availableSpace,
		currentUsage,
		formattedCurrentUsage: formatBytes(currentUsage),
		formattedStorageLimit: formatBytes(storageLimit),
		storageLimit,
		usagePercent,
	};
}
