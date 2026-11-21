import path from "node:path";
import { logError } from "@workspace/shared/logger";
import {
	isRagIndexableContentType,
	STORAGE_CONFIG,
} from "@workspace/shared/storage";
import { extractText } from "unpdf";
import { env } from "../../env";
import { AppError, NotFoundError, ValidationError } from "../../lib/errors";
import {
	formatBytes,
	generateStorageKey,
	isAllowedContentType,
	isValidFileSize,
} from "../../lib/storage";
import {
	deleteUploadKnowledgeFromMastra,
	indexUploadKnowledgeInMastra,
	isSemanticRecallEnabled,
} from "../ai/runtime";
import { deleteS3ObjectWithRetry } from "./folders";
import {
	assertQuotaFits,
	escapeIlikePattern,
	getPrivateFileProxyUrl,
	requireCommittedUpload,
	resolveFilePresentation,
} from "./helpers";
import type { StorageRepository, UploadRow } from "./repository";
import {
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
	UpdateUploadInput,
} from "./schema";

const MAX_RAG_INDEX_BYTES = 256 * 1024;

async function verifyUploadedObject(uploadRow: UploadRow): Promise<number> {
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

async function readBoundedStreamText(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number
): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	try {
		while (totalBytes < maxBytes) {
			// biome-ignore lint/performance/noAwaitInLoops: sequential stream reader loop
			const { done, value } = await reader.read();
			if (done || !value) {
				break;
			}
			const remaining = maxBytes - totalBytes;
			const slice =
				value.byteLength > remaining ? value.subarray(0, remaining) : value;
			chunks.push(slice);
			totalBytes += slice.byteLength;
			if (totalBytes >= maxBytes) {
				await reader.cancel();
				break;
			}
		}
	} finally {
		reader.releaseLock();
	}

	const combined = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(combined);
}

async function extractUploadKnowledgeText(
	stream: ReadableStream<Uint8Array>,
	normalizedType: string
): Promise<string> {
	if (normalizedType === "application/pdf") {
		try {
			const buffer = await new Response(stream).arrayBuffer();
			const { text } = await extractText(new Uint8Array(buffer), {
				mergePages: true,
			});
			return text.slice(0, MAX_RAG_INDEX_BYTES);
		} catch (error) {
			throw new ValidationError(
				"Could not extract text from PDF (file may be encrypted or corrupted)",
				{ cause: error, field: "contentType" }
			);
		}
	}
	return await readBoundedStreamText(stream, MAX_RAG_INDEX_BYTES);
}

export function createUploadService(repository: StorageRepository) {
	async function fetchUploadFileStream(params: {
		id: string;
		organizationId: string;
	}) {
		const record = await requireCommittedUpload(
			repository,
			params.organizationId,
			params.id
		);

		const { contentType, downloadDisposition } = resolveFilePresentation(
			record.fileKey,
			record.contentType,
			record.metadata?.originalName
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
			if (error instanceof AppError) {
				throw error;
			}
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

	return {
		async commitUploads(params: {
			input: CommitUploadsInput;
			organizationId: string;
		}) {
			const { input, organizationId } = params;
			const uniqueKeys = Array.from(new Set(input.fileKeys));
			const now = new Date();

			// Pre-fetch outside lock to verify existence and run HeadObject checks before DB row locks
			const pendingPreview = await repository.findPendingUploadsByKeys(
				organizationId,
				uniqueKeys
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

			const result = await repository.transaction(async (tx) => {
				const lockedUploads = await tx.findLockedPendingUploads({
					fileKeys: uniqueKeys,
					now,
					organizationId,
				});

				if (lockedUploads.length !== uniqueKeys.length) {
					throw new NotFoundError(
						"One or more pending uploads expired or were already committed"
					);
				}

				const lockedLimit = await tx.ensureAndLockStorageLimit(organizationId);
				const currentUsage = lockedLimit?.currentUsage ?? 0;
				const storageLimit =
					lockedLimit?.storageLimit ?? STORAGE_CONFIG.BYTES_PER_GB;

				if (currentUsage + totalVerifiedBytes > storageLimit) {
					throw new ValidationError(
						`Storage quota exceeded. Used ${formatBytes(currentUsage)} of ${formatBytes(storageLimit)}.`,
						"size"
					);
				}

				const updatedRows = await tx.commitPendingUploads({
					fileKeys: uniqueKeys,
					now,
					organizationId,
				});

				if (updatedRows.length !== uniqueKeys.length) {
					throw new ValidationError(
						"Concurrent upload commit conflict",
						"fileKeys"
					);
				}

				await tx.incrementStorageUsage(organizationId, totalVerifiedBytes, now);

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
		},

		async deleteUpload(params: {
			fileKey?: string;
			id?: string;
			organizationId: string;
		}) {
			const { fileKey, id, organizationId } = params;
			if (!(id || fileKey)) {
				throw new ValidationError("Upload identifier is required");
			}

			const { deletedBucket, deletedFileKey, deletedId } =
				await repository.transaction(async (tx) => {
					const existing = await tx.findLockedUploadByFilter({
						fileKey,
						id,
						organizationId,
					});

					if (!existing) {
						throw new NotFoundError("File not found or unauthorized");
					}

					const deleted = await tx.deleteUploadById(
						organizationId,
						existing.id
					);

					if (deleted?.size && deleted.status === "committed") {
						await tx.decrementStorageUsage(
							organizationId,
							deleted.size,
							new Date()
						);
					}

					return {
						deletedBucket: existing.bucket,
						deletedFileKey: existing.fileKey,
						deletedId: existing.id,
					};
				});

			await deleteS3ObjectWithRetry(deletedBucket, deletedFileKey, deletedId);
			await deleteUploadKnowledgeFromMastra({
				organizationId,
				uploadId: deletedId,
			}).catch((error) => {
				logError("deleteUpload:KnowledgeCleanup", error, {
					organizationId,
					uploadId: deletedId,
				});
			});

			return {
				fileKey: deletedFileKey,
				id: deletedId,
				success: true,
			};
		},

		async getStorageUsage(organizationId: string) {
			const record = await repository.getStorageLimit(organizationId);
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
		},

		getUploadFileStream: fetchUploadFileStream,

		async getUploadSignedDownloadUrl(params: {
			id: string;
			organizationId: string;
		}) {
			if (!hasConfiguredS3Credentials()) {
				throw new AppError(
					"Object storage credentials are not configured",
					503,
					"STORAGE_UNAVAILABLE"
				);
			}

			const record = await requireCommittedUpload(
				repository,
				params.organizationId,
				params.id
			);

			const { contentType, disposition } = resolveFilePresentation(
				record.fileKey,
				record.contentType,
				record.metadata?.originalName
			);

			let url: string;
			try {
				url = await presignGetObject({
					bucket: record.bucket,
					contentDisposition: disposition,
					contentType,
					expiresIn: STORAGE_CONFIG.DOWNLOAD_URL_EXPIRY_SECONDS,
					fileKey: record.fileKey,
				});
			} catch (error) {
				logError("getUploadSignedDownloadUrl:S3Signer", error, {
					fileKey: record.fileKey,
					organizationId: params.organizationId,
				});
				throw new AppError("Failed to generate storage download URL", {
					cause: error,
					code: "STORAGE_UNAVAILABLE",
					statusCode: 503,
				});
			}

			return {
				expiresIn: STORAGE_CONFIG.DOWNLOAD_URL_EXPIRY_SECONDS,
				url,
			};
		},

		async indexUploadKnowledge(params: { id: string; organizationId: string }) {
			const record = await requireCommittedUpload(
				repository,
				params.organizationId,
				params.id
			);
			const normalizedType =
				record.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
			if (!isRagIndexableContentType(normalizedType)) {
				throw new ValidationError(
					"Only PDF, Markdown, plain text, CSV, and JSON files can be indexed for AI knowledge search",
					"contentType"
				);
			}

			if (!isSemanticRecallEnabled()) {
				return {
					chunkCount: 0,
					id: record.id,
					indexed: false,
				};
			}

			const { stream } = await fetchUploadFileStream(params);
			const rawText = await extractUploadKnowledgeText(stream, normalizedType);
			const fileName =
				typeof record.metadata?.originalName === "string" &&
				record.metadata.originalName.trim().length > 0
					? record.metadata.originalName.trim()
					: path.posix.basename(record.fileKey) || record.id;

			const { chunkCount, indexed } = await indexUploadKnowledgeInMastra({
				content: rawText,
				fileName,
				organizationId: params.organizationId,
				uploadId: record.id,
			});

			const nextMetadata = {
				...(record.metadata ?? {}),
				ragChunkCount: chunkCount,
				ragIndexedAt: indexed ? new Date().toISOString() : null,
			};

			await repository.updateUpload({
				id: record.id,
				organizationId: params.organizationId,
				updates: {
					metadata: nextMetadata,
					updatedAt: new Date(),
				},
			});

			return {
				chunkCount,
				id: record.id,
				indexed,
			};
		},

		async listUploads(params: {
			organizationId: string;
			query: ListUploadsQuery;
		}) {
			const { organizationId, query } = params;
			const escapedSearch = query.search
				? escapeIlikePattern(query.search)
				: undefined;

			const { items, total } = await repository.listUploads({
				escapedSearch,
				organizationId,
				query,
			});

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
		},

		async presignUpload(params: {
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
				const folderId = await repository.findFolderId(
					organizationId,
					input.folderId
				);
				if (!folderId) {
					throw new NotFoundError("Folder", "folderId");
				}
			}

			const now = new Date();
			const preflightQuota = await repository.getQuotaSnapshot(
				organizationId,
				now
			);
			assertQuotaFits({
				additionalBytes: input.size,
				limit: preflightQuota.limit,
				pendingReservedBytes: preflightQuota.pendingReservedBytes,
			});

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

			const created = await repository.transaction(async (tx) => {
				const lockedLimit = await tx.ensureAndLockStorageLimit(organizationId);
				const pendingReservedBytes = await tx.getPendingReservedBytes(
					organizationId,
					now
				);
				assertQuotaFits({
					additionalBytes: input.size,
					limit: lockedLimit,
					pendingReservedBytes,
				});

				return await tx.insertPendingUpload({
					bucket: env.S3_BUCKET,
					contentType: input.contentType,
					expiresAt,
					fileKey,
					folderId: input.folderId ?? null,
					metadata: {
						...(input.metadata ?? {}),
						originalName: input.fileName,
					},
					organizationId,
					size: input.size,
					status: "pending",
					userId,
				});
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
		},

		async updateUpload(params: {
			id: string;
			input: UpdateUploadInput;
			organizationId: string;
		}) {
			const { id, input, organizationId } = params;
			const existing = await requireCommittedUpload(
				repository,
				organizationId,
				id
			);

			if (input.folderId !== undefined && input.folderId !== null) {
				const targetFolderId = await repository.findFolderId(
					organizationId,
					input.folderId
				);
				if (!targetFolderId) {
					throw new NotFoundError("Folder", "folderId");
				}
			}

			const nextFolderId =
				input.folderId === undefined ? existing.folderId : input.folderId;
			const nextMetadata =
				input.fileName === undefined
					? existing.metadata
					: {
							...(existing.metadata ?? {}),
							originalName: input.fileName,
						};

			const updated = await repository.updateUpload({
				id: existing.id,
				organizationId,
				updates: {
					folderId: nextFolderId,
					metadata: nextMetadata,
					updatedAt: new Date(),
				},
			});

			if (!updated) {
				throw new NotFoundError("File");
			}

			const fileUrl = getPrivateFileProxyUrl(updated.id);
			return {
				...updated,
				fileUrl,
				publicUrl: fileUrl,
			};
		},
	};
}
