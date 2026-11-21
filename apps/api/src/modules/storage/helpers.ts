import path from "node:path";
import { STORAGE_CONFIG } from "@workspace/shared/storage";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { formatBytes } from "../../lib/storage";
import type {
	StorageLimitRow,
	StorageRepository,
	UploadRow,
} from "./repository";

const UNSAFE_DISPOSITION_CHARS_REGEX = /[\r\n"\\]/gu;
const SAFE_INLINE_IMAGE_TYPES = new Set([
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
	"image/gif",
]);

export function getPrivateFileProxyUrl(uploadId: string): string {
	return `/api/storage/files/${uploadId}`;
}

export function escapeIlikePattern(value: string): string {
	return value.replace(/[\\%_]/gu, "\\$&");
}

export function resolveFilePresentation(
	fileKey: string,
	rawContentType: string | null,
	originalName?: unknown
) {
	const contentType = rawContentType ?? "application/octet-stream";
	const isInline = SAFE_INLINE_IMAGE_TYPES.has(contentType);
	const preferredName =
		typeof originalName === "string" && originalName.trim().length > 0
			? originalName.trim().replace(UNSAFE_DISPOSITION_CHARS_REGEX, "_")
			: "";
	const fileName = preferredName || path.posix.basename(fileKey) || "download";
	return {
		contentType,
		disposition: isInline ? "inline" : "attachment",
		downloadDisposition: isInline
			? `inline; filename="${fileName}"`
			: `attachment; filename="${fileName}"`,
	};
}

export function assertQuotaFits(params: {
	additionalBytes: number;
	limit: StorageLimitRow | null;
	pendingReservedBytes: number;
}) {
	const storageLimit =
		params.limit?.storageLimit ?? STORAGE_CONFIG.BYTES_PER_GB;
	const currentUsage = params.limit?.currentUsage ?? 0;

	if (
		currentUsage + params.pendingReservedBytes + params.additionalBytes >
		storageLimit
	) {
		throw new ValidationError(
			`Storage quota exceeded. Used ${formatBytes(currentUsage)} (plus ${formatBytes(params.pendingReservedBytes)} pending) of ${formatBytes(storageLimit)}.`,
			"size"
		);
	}
}

export async function requireCommittedUpload(
	repository: StorageRepository,
	organizationId: string,
	id: string
): Promise<UploadRow> {
	const record = await repository.findCommittedUploadById(organizationId, id);
	if (!record) {
		throw new NotFoundError("File");
	}
	return record;
}

export function collectDescendantFolderIds(
	rootId: string,
	allFolders: ReadonlyArray<{ id: string; parentId: string | null }>
): string[] {
	const childrenByParent = new Map<string, string[]>();
	for (const folder of allFolders) {
		if (!folder.parentId) {
			continue;
		}
		const siblings = childrenByParent.get(folder.parentId) ?? [];
		siblings.push(folder.id);
		childrenByParent.set(folder.parentId, siblings);
	}

	const collected = new Set<string>([rootId]);
	const queue = [rootId];
	while (queue.length > 0) {
		const currentId = queue.shift();
		if (!currentId) {
			continue;
		}
		for (const childId of childrenByParent.get(currentId) ?? []) {
			if (!collected.has(childId)) {
				collected.add(childId);
				queue.push(childId);
			}
		}
	}
	return Array.from(collected);
}
