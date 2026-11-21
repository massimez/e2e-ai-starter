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
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { AppError, ConflictError, isPgErrorCode } from "../../lib/errors";
import { withActiveOrg } from "../../lib/tenant";
import type { ListUploadsQuery } from "./schema";

export type UploadRow = typeof uploads.$inferSelect;
export type UploadInsert = typeof uploads.$inferInsert;
export type StorageLimitRow = typeof organizationStorageLimits.$inferSelect;

function getStorageLimitRow(
	executor: Pick<typeof db, "select">,
	organizationId: string
): Promise<StorageLimitRow[]> {
	return executor
		.select()
		.from(organizationStorageLimits)
		.where(eq(organizationStorageLimits.organizationId, organizationId))
		.limit(1);
}

async function getPendingReservedBytesFromExecutor(
	executor: Pick<typeof db, "select">,
	organizationId: string,
	now: Date
): Promise<number> {
	const [pendingRow] = await executor
		.select({
			reservedBytes: sql<number>`COALESCE(SUM(${uploads.size}), 0)`,
		})
		.from(uploads)
		.where(
			withActiveOrg(
				uploads,
				organizationId,
				eq(uploads.status, "pending"),
				or(isNull(uploads.expiresAt), gt(uploads.expiresAt, now))
			)
		);
	return Number(pendingRow?.reservedBytes ?? 0);
}

function createDrizzleStorageTxRepository(tx: typeof db) {
	return {
		async commitPendingUploads(params: {
			fileKeys: string[];
			now: Date;
			organizationId: string;
			updatedBy?: string;
		}) {
			return await tx
				.update(uploads)
				.set({
					status: "committed",
					updatedAt: params.now,
					updatedBy: params.updatedBy ?? null,
				})
				.where(
					withActiveOrg(
						uploads,
						params.organizationId,
						inArray(uploads.fileKey, params.fileKeys),
						eq(uploads.status, "pending")
					)
				)
				.returning();
		},

		async decrementStorageUsage(
			organizationId: string,
			bytes: number,
			now: Date
		): Promise<void> {
			await tx
				.update(organizationStorageLimits)
				.set({
					currentUsage: sql`GREATEST(0, ${organizationStorageLimits.currentUsage} - ${bytes})`,
					updatedAt: now,
				})
				.where(eq(organizationStorageLimits.organizationId, organizationId));
		},

		async ensureAndLockStorageLimit(organizationId: string) {
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
			return lockedLimit ?? null;
		},

		async findFolderSummaries(organizationId: string) {
			return await tx
				.select({
					id: storageFolders.id,
					parentId: storageFolders.parentId,
				})
				.from(storageFolders)
				.where(withActiveOrg(storageFolders, organizationId));
		},

		async findLockedPendingUploads(params: {
			fileKeys: string[];
			now: Date;
			organizationId: string;
		}) {
			return await tx
				.select()
				.from(uploads)
				.where(
					withActiveOrg(
						uploads,
						params.organizationId,
						inArray(uploads.fileKey, params.fileKeys),
						eq(uploads.status, "pending"),
						or(isNull(uploads.expiresAt), gt(uploads.expiresAt, params.now))
					)
				)
				.orderBy(asc(uploads.id))
				.for("update");
		},

		async findLockedUploadByFilter(params: {
			fileKey?: string;
			id?: string;
			organizationId: string;
		}) {
			let filter: SQL | null = null;
			if (params.id) {
				filter = withActiveOrg(
					uploads,
					params.organizationId,
					eq(uploads.id, params.id)
				);
			} else if (params.fileKey) {
				filter = withActiveOrg(
					uploads,
					params.organizationId,
					eq(uploads.fileKey, params.fileKey)
				);
			}
			if (!filter) {
				return null;
			}
			const [existing] = await tx
				.select()
				.from(uploads)
				.where(filter)
				.for("update")
				.limit(1);
			return existing ?? null;
		},

		async findLockedUploadsByFolderIds(
			organizationId: string,
			folderIds: string[]
		) {
			if (folderIds.length === 0) {
				return [];
			}
			return await tx
				.select()
				.from(uploads)
				.where(
					withActiveOrg(
						uploads,
						organizationId,
						inArray(uploads.folderId, folderIds)
					)
				)
				.for("update");
		},

		async getPendingReservedBytes(
			organizationId: string,
			now: Date
		): Promise<number> {
			return await getPendingReservedBytesFromExecutor(tx, organizationId, now);
		},

		async incrementStorageUsage(
			organizationId: string,
			bytes: number,
			now: Date
		): Promise<void> {
			await tx
				.update(organizationStorageLimits)
				.set({
					currentUsage: sql`${organizationStorageLimits.currentUsage} + ${bytes}`,
					updatedAt: now,
				})
				.where(eq(organizationStorageLimits.organizationId, organizationId));
		},

		async insertPendingUpload(values: UploadInsert) {
			const [inserted] = await tx.insert(uploads).values(values).returning();
			if (!inserted) {
				throw new AppError("Failed to create upload record", 500);
			}
			return inserted;
		},

		async softDeleteFoldersByIds(
			organizationId: string,
			ids: string[],
			now: Date,
			updatedBy?: string
		) {
			if (ids.length === 0) {
				return [];
			}
			return await tx
				.update(storageFolders)
				.set({
					deletedAt: now,
					updatedAt: now,
					updatedBy: updatedBy ?? null,
				})
				.where(
					withActiveOrg(
						storageFolders,
						organizationId,
						inArray(storageFolders.id, ids)
					)
				)
				.returning();
		},

		async softDeleteUploadById(
			organizationId: string,
			id: string,
			now: Date,
			updatedBy?: string
		) {
			const [deleted] = await tx
				.update(uploads)
				.set({
					deletedAt: now,
					updatedAt: now,
					updatedBy: updatedBy ?? null,
				})
				.where(withActiveOrg(uploads, organizationId, eq(uploads.id, id)))
				.returning();
			return deleted ?? null;
		},

		async softDeleteUploadsByIds(
			organizationId: string,
			ids: string[],
			now: Date,
			updatedBy?: string
		): Promise<void> {
			if (ids.length === 0) {
				return;
			}
			await tx
				.update(uploads)
				.set({
					deletedAt: now,
					updatedAt: now,
					updatedBy: updatedBy ?? null,
				})
				.where(
					withActiveOrg(uploads, organizationId, inArray(uploads.id, ids))
				);
		},
	};
}

export type StorageTxRepository = ReturnType<
	typeof createDrizzleStorageTxRepository
>;

/**
 * Builds the Drizzle-backed repository for storage uploads, folders, and quotas.
 */
export function createDrizzleStorageRepository(database = db) {
	return {
		async createFolder(params: {
			createdBy?: string;
			name: string;
			organizationId: string;
			parentId: string | null;
		}) {
			try {
				const [created] = await database
					.insert(storageFolders)
					.values({
						createdBy: params.createdBy ?? null,
						name: params.name,
						organizationId: params.organizationId,
						parentId: params.parentId,
						updatedBy: params.createdBy ?? null,
					})
					.returning();
				if (!created) {
					throw new AppError("Failed to create folder", 500);
				}
				return created;
			} catch (error) {
				if (isPgErrorCode(error, "23505")) {
					throw new ConflictError("A folder with this name already exists", {
						cause: error,
						field: "name",
					});
				}
				throw error;
			}
		},

		async findCommittedUploadById(organizationId: string, id: string) {
			const [record] = await database
				.select()
				.from(uploads)
				.where(
					withActiveOrg(
						uploads,
						organizationId,
						eq(uploads.id, id),
						eq(uploads.status, "committed")
					)
				)
				.limit(1);
			return record ?? null;
		},

		async findFolderId(
			organizationId: string,
			id: string
		): Promise<string | null> {
			const [folder] = await database
				.select({ id: storageFolders.id })
				.from(storageFolders)
				.where(
					withActiveOrg(
						storageFolders,
						organizationId,
						eq(storageFolders.id, id)
					)
				)
				.limit(1);
			return folder?.id ?? null;
		},

		async findPendingUploadsByKeys(organizationId: string, fileKeys: string[]) {
			if (fileKeys.length === 0) {
				return [];
			}
			return await database
				.select()
				.from(uploads)
				.where(
					withActiveOrg(
						uploads,
						organizationId,
						inArray(uploads.fileKey, fileKeys),
						eq(uploads.status, "pending")
					)
				);
		},

		async getQuotaSnapshot(organizationId: string, now: Date) {
			const [limitRows, pendingReservedBytes] = await Promise.all([
				getStorageLimitRow(database, organizationId),
				getPendingReservedBytesFromExecutor(database, organizationId, now),
			]);
			return {
				limit: limitRows[0] ?? null,
				pendingReservedBytes,
			};
		},

		async getStorageLimit(organizationId: string) {
			const [record] = await getStorageLimitRow(database, organizationId);
			return record ?? null;
		},

		async listFoldersWithCounts(organizationId: string) {
			const [folders, fileCounts] = await Promise.all([
				database
					.select()
					.from(storageFolders)
					.where(withActiveOrg(storageFolders, organizationId))
					.orderBy(asc(storageFolders.name)),
				database
					.select({
						fileCount: count(),
						folderId: uploads.folderId,
					})
					.from(uploads)
					.where(
						and(
							withActiveOrg(
								uploads,
								organizationId,
								eq(uploads.status, "committed")
							),
							sql`${uploads.folderId} IS NOT NULL`
						)
					)
					.groupBy(uploads.folderId),
			]);

			return {
				fileCounts: fileCounts.map((row) => ({
					fileCount: Number(row.fileCount ?? 0),
					folderId: row.folderId,
				})),
				folders,
			};
		},

		async listUploads(params: {
			escapedSearch?: string;
			organizationId: string;
			query: ListUploadsQuery;
		}) {
			const { escapedSearch, organizationId, query } = params;
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
			if (escapedSearch) {
				const pattern = `%${escapedSearch}%`;
				extraConditions.push(
					sql`(${uploads.fileKey} ILIKE ${pattern} ESCAPE '\\' OR COALESCE(${uploads.metadata}->>'originalName', '') ILIKE ${pattern} ESCAPE '\\')`
				);
			}

			const whereClause = withActiveOrg(
				uploads,
				organizationId,
				...extraConditions
			);

			const [items, totalRows] = await Promise.all([
				database
					.select()
					.from(uploads)
					.where(whereClause)
					.orderBy(desc(uploads.createdAt))
					.limit(query.limit)
					.offset(offset),
				database.select({ total: count() }).from(uploads).where(whereClause),
			]);

			return {
				items,
				total: totalRows[0]?.total ?? 0,
			};
		},

		async transaction<T>(
			fn: (txRepo: StorageTxRepository) => Promise<T>
		): Promise<T> {
			return await database.transaction(
				async (tx) =>
					await fn(createDrizzleStorageTxRepository(tx as unknown as typeof db))
			);
		},

		async updateFolderName(params: {
			id: string;
			name: string;
			now: Date;
			organizationId: string;
			updatedBy?: string;
		}) {
			try {
				const [updated] = await database
					.update(storageFolders)
					.set({
						name: params.name,
						updatedAt: params.now,
						updatedBy: params.updatedBy ?? null,
					})
					.where(
						withActiveOrg(
							storageFolders,
							params.organizationId,
							eq(storageFolders.id, params.id)
						)
					)
					.returning();
				return updated ?? null;
			} catch (error) {
				if (isPgErrorCode(error, "23505")) {
					throw new ConflictError("A folder with this name already exists", {
						cause: error,
						field: "name",
					});
				}
				throw error;
			}
		},

		async updateUpload(params: {
			id: string;
			organizationId: string;
			updates: Partial<UploadInsert>;
		}) {
			const [updated] = await database
				.update(uploads)
				.set(params.updates)
				.where(
					withActiveOrg(
						uploads,
						params.organizationId,
						eq(uploads.id, params.id)
					)
				)
				.returning();
			return updated ?? null;
		},
	};
}

export type StorageRepository = ReturnType<
	typeof createDrizzleStorageRepository
>;

export const drizzleStorageRepository = createDrizzleStorageRepository();
