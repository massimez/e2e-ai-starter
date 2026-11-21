import { logError } from "@workspace/shared/logger";
import { NotFoundError } from "../../lib/errors";
import { deleteUploadKnowledgeFromMastra } from "../ai/runtime";
import { collectDescendantFolderIds } from "./helpers";
import type { StorageRepository } from "./repository";
import { deleteS3Object, isS3NotFoundError } from "./s3";
import type {
	CreateStorageFolderInput,
	UpdateStorageFolderInput,
} from "./schema";

export async function deleteS3ObjectWithRetry(
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

export function createFolderService(repository: StorageRepository) {
	return {
		async createStorageFolder(params: {
			input: CreateStorageFolderInput;
			organizationId: string;
			userId?: string;
		}) {
			const { input, organizationId, userId } = params;
			if (input.parentId) {
				const parentId = await repository.findFolderId(
					organizationId,
					input.parentId
				);
				if (!parentId) {
					throw new NotFoundError("Parent folder", "parentId");
				}
			}

			const created = await repository.createFolder({
				createdBy: userId,
				name: input.name,
				organizationId,
				parentId: input.parentId ?? null,
			});

			return {
				...created,
				fileCount: 0,
			};
		},

		async deleteStorageFolder(params: {
			id: string;
			organizationId: string;
			userId?: string;
		}) {
			const { id, organizationId, userId } = params;
			const now = new Date();

			const { deletedUploads, reclaimedBytes } = await repository.transaction(
				async (tx) => {
					const orgFolders = await tx.findFolderSummaries(organizationId);
					if (!orgFolders.some((folder) => folder.id === id)) {
						throw new NotFoundError("Folder");
					}

					const folderIdsToRemove = collectDescendantFolderIds(id, orgFolders);
					const folderUploads = await tx.findLockedUploadsByFolderIds(
						organizationId,
						folderIdsToRemove
					);

					await tx.softDeleteUploadsByIds(
						organizationId,
						folderUploads.map((item) => item.id),
						now,
						userId
					);

					const totalCommittedBytes = folderUploads.reduce(
						(sum, row) =>
							row.status === "committed" && row.size && row.size > 0
								? sum + row.size
								: sum,
						0
					);

					if (totalCommittedBytes > 0) {
						await tx.decrementStorageUsage(
							organizationId,
							totalCommittedBytes,
							now
						);
					}

					const deletedFolders = await tx.softDeleteFoldersByIds(
						organizationId,
						folderIdsToRemove,
						now,
						userId
					);
					if (!deletedFolders.some((folder) => folder.id === id)) {
						throw new NotFoundError("Folder");
					}

					return {
						deletedUploads: folderUploads,
						reclaimedBytes: totalCommittedBytes,
					};
				}
			);

			await Promise.allSettled(
				deletedUploads.flatMap((row) => [
					deleteS3ObjectWithRetry(row.bucket, row.fileKey, row.id),
					deleteUploadKnowledgeFromMastra({
						organizationId,
						uploadId: row.id,
					}).catch((error) => {
						logError("deleteStorageFolder:KnowledgeCleanup", error, {
							folderId: id,
							organizationId,
							uploadId: row.id,
						});
					}),
				])
			);

			return {
				deletedBytes: reclaimedBytes,
				deletedFilesCount: deletedUploads.length,
				id,
				success: true,
			};
		},

		async listStorageFolders(organizationId: string) {
			const { fileCounts, folders } =
				await repository.listFoldersWithCounts(organizationId);

			const countByFolderId = new Map<string, number>();
			for (const row of fileCounts) {
				if (row.folderId) {
					countByFolderId.set(row.folderId, row.fileCount);
				}
			}

			return folders.map((folder) => ({
				...folder,
				fileCount: countByFolderId.get(folder.id) ?? 0,
			}));
		},

		async updateStorageFolder(params: {
			id: string;
			input: UpdateStorageFolderInput;
			organizationId: string;
			userId?: string;
		}) {
			const updated = await repository.updateFolderName({
				id: params.id,
				name: params.input.name,
				now: new Date(),
				organizationId: params.organizationId,
				updatedBy: params.userId,
			});

			if (!updated) {
				throw new NotFoundError("Folder");
			}
			return updated;
		},
	};
}
