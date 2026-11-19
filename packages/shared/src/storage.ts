export const STORAGE_CONFIG = {
	ALLOWED_CONTENT_TYPES: [
		"image/jpeg",
		"image/jpg",
		"image/png",
		"image/webp",
		"image/gif",
		"application/pdf",
		"text/plain",
		"text/markdown",
		"text/csv",
		"application/json",
	] as const,
	BYTES_PER_GB: 1024 * 1024 * 1024,
	BYTES_PER_KB: 1024,
	BYTES_PER_MB: 1024 * 1024,
	DOWNLOAD_URL_EXPIRY_SECONDS: 300,
	MAX_FILE_SIZE: 10 * 1024 * 1024, // 10 MB
	PRESIGN_EXPIRY_SECONDS: 900,
	RAG_INDEXABLE_CONTENT_TYPES: [
		"application/pdf",
		"text/plain",
		"text/markdown",
		"text/csv",
		"application/json",
	] as const,
} as const;

export type StorageConfig = typeof STORAGE_CONFIG;

export function formatBytes(bytes: number, decimals = 2): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 Bytes";
	}

	const k = STORAGE_CONFIG.BYTES_PER_KB;
	const dm = Math.max(decimals, 0);
	const sizes = ["Bytes", "KB", "MB", "GB", "TB"] as const;
	const i = Math.min(
		Math.floor(Math.log(bytes) / Math.log(k)),
		sizes.length - 1
	);

	return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

export function isAllowedContentType(contentType: string): boolean {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return (STORAGE_CONFIG.ALLOWED_CONTENT_TYPES as readonly string[]).includes(
		normalized
	);
}

export function isRagIndexableContentType(
	contentType: string | null | undefined
): boolean {
	if (!contentType) {
		return false;
	}
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return (
		STORAGE_CONFIG.RAG_INDEXABLE_CONTENT_TYPES as readonly string[]
	).includes(normalized);
}

export function isValidFileSize(size: number): boolean {
	return (
		Number.isInteger(size) && size > 0 && size <= STORAGE_CONFIG.MAX_FILE_SIZE
	);
}
