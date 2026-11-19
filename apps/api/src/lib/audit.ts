import { db } from "@workspace/db";
import { type AuditLogDetails, auditLog } from "@workspace/db/schema";
import { logError } from "@workspace/shared/logger";

export { extractClientIp, isTrustedProxyIp } from "./ip";

export interface AuditLogRecord {
	action: string;
	details?: AuditLogDetails;
	entityId?: string | null;
	entityType?: string | null;
	ipAddress?: string | null;
	organizationId?: string | null;
	userAgent?: string | null;
	userId?: string | null;
}

export type AuditLogWriter = (record: AuditLogRecord) => Promise<void>;

export const DEFAULT_SENSITIVE_READ_PREFIXES = [
	"/auth/admin",
	"/auth/organization",
	"/storage/files",
	"/billing",
	"/admin",
	"/audit",
	"/api-keys",
	"/settings/security",
	"/organization/security",
] as const;

export const API_PREFIX_REGEX = /^\/api(?=\/|$)/u;

const MAX_ACTION_LENGTH = 120;
const MAX_ENTITY_TYPE_LENGTH = 80;

export function normalizeRoutePath(path: string): string {
	const stripped = path.replace(API_PREFIX_REGEX, "");
	return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

export function isSensitiveReadPath(
	path: string,
	sensitivePrefixes: readonly string[] = DEFAULT_SENSITIVE_READ_PREFIXES
): boolean {
	const normalized = normalizeRoutePath(path);
	for (const prefix of sensitivePrefixes) {
		if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
			return true;
		}
	}
	return false;
}

export async function persistAuditLog(record: AuditLogRecord): Promise<void> {
	try {
		await db.insert(auditLog).values({
			action: record.action.slice(0, MAX_ACTION_LENGTH),
			details: record.details ?? {},
			entityId: record.entityId ?? null,
			entityType: record.entityType
				? record.entityType.slice(0, MAX_ENTITY_TYPE_LENGTH)
				: null,
			ipAddress: record.ipAddress ?? null,
			organizationId: record.organizationId ?? null,
			userAgent: record.userAgent ?? null,
			userId: record.userId ?? null,
		});
	} catch (error) {
		logError("persistAuditLog", error, {
			action: record.action.slice(0, MAX_ACTION_LENGTH),
		});
	}
}
