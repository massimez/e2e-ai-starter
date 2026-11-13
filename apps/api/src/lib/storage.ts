import { randomUUID } from "node:crypto";
import path from "node:path";

export {
	formatBytes,
	isAllowedContentType,
	isValidFileSize,
	STORAGE_CONFIG,
	type StorageConfig,
} from "../modules/storage/config";

const NON_PATH_SEGMENT_CHARS_REGEX = /[^a-zA-Z0-9_-]/gu;
const EDGE_UNDERSCORES_REGEX = /^_+|_+$/gu;
const BACKSLASH_REGEX = /\\/gu;
const MULTI_DOT_REGEX = /\.\.+/gu;
const LEADING_DOTS_REGEX = /^\.+/u;
const NON_FILENAME_CHARS_REGEX = /[^a-z0-9._-]/gu;
const MULTI_UNDERSCORE_REGEX = /_+/gu;

function sanitizePathSegment(
	raw: string | null | undefined,
	fallback: string
): string {
	const cleaned = (raw ?? "")
		.replace(NON_PATH_SEGMENT_CHARS_REGEX, "_")
		.replace(EDGE_UNDERSCORES_REGEX, "");
	return cleaned || fallback;
}

export function sanitizeFileName(rawFileName: string): string {
	const base = path.posix.basename(rawFileName.replace(BACKSLASH_REGEX, "/"));
	const sanitized = base
		.toLowerCase()
		.replace(MULTI_DOT_REGEX, ".")
		.replace(LEADING_DOTS_REGEX, "")
		.replace(NON_FILENAME_CHARS_REGEX, "_")
		.replace(MULTI_UNDERSCORE_REGEX, "_")
		.slice(0, 120);

	return sanitized || "file";
}

export function generateStorageKey(params: {
	organizationId?: string | null;
	entityType: string;
	entityId?: string | null;
	fileName: string;
}): string {
	const sanitizedName = sanitizeFileName(params.fileName);
	const uid = randomUUID().slice(0, 8);
	const prefix = params.organizationId
		? `org_${sanitizePathSegment(params.organizationId, "unknown")}`
		: "global";
	const safeEntityType = sanitizePathSegment(params.entityType, "uploads");
	const safeEntityId = params.entityId
		? sanitizePathSegment(params.entityId, "")
		: "";
	const entitySegment = safeEntityId
		? `${safeEntityType}/${safeEntityId}`
		: safeEntityType;

	return `${prefix}/${entitySegment}/${uid}-${sanitizedName}`;
}
