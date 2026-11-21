import { createFolderService } from "./folders";
import { drizzleStorageRepository, type StorageRepository } from "./repository";
import { createUploadService } from "./uploads";

export { escapeIlikePattern, getPrivateFileProxyUrl } from "./helpers";

/**
 * Builds the storage domain service backed by the given repository.
 */
export function createStorageService(
	repository: StorageRepository = drizzleStorageRepository
) {
	return {
		...createFolderService(repository),
		...createUploadService(repository),
	};
}

export const storageService = createStorageService();

export const {
	commitUploads,
	createStorageFolder,
	deleteStorageFolder,
	deleteUpload,
	getStorageUsage,
	getUploadFileStream,
	getUploadSignedDownloadUrl,
	indexUploadKnowledge,
	listStorageFolders,
	listUploads,
	presignUpload,
	updateStorageFolder,
	updateUpload,
} = storageService;
