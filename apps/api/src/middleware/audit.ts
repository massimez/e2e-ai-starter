import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import {
	API_PREFIX_REGEX,
	type AuditLogRecord,
	type AuditLogWriter,
	DEFAULT_SENSITIVE_READ_PREFIXES,
	extractClientIp,
	isSensitiveReadPath,
	persistAuditLog,
} from "../lib/audit";
import type { AppEnv } from "../lib/create-hono-app";
import { logError, sanitizeRequestPath } from "../lib/logger";
import type { TenantMismatchSecurityEvent } from "../lib/tenant";

export interface AccessAuditMiddlewareOptions {
	scope?: string;
	sensitivePrefixes?: readonly string[];
	writeAuditLog?: AuditLogWriter;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ACCESS_DENIED_STATUSES = new Set([401, 403, 423]);
const UUID_OR_ID_SEGMENT_REGEX =
	/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{16,}|\d+)$/iu;

const MAX_ACTION_LENGTH = 120;
const MAX_ENTITY_TYPE_LENGTH = 80;

const pendingAuditWrites = new Set<Promise<void>>();

export async function drainAuditLogs(timeoutMs = 3000): Promise<void> {
	if (pendingAuditWrites.size === 0) {
		return;
	}
	const drainPromise = Promise.allSettled(Array.from(pendingAuditWrites));
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		drainPromise,
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, timeoutMs);
		}),
	]);
	if (timer) {
		clearTimeout(timer);
	}
}

function extractEntityFromPath(path: string): {
	entityId: string | null;
	entityType: string | null;
} {
	const segments = path
		.replace(API_PREFIX_REGEX, "")
		.split("/")
		.filter(Boolean);

	if (segments.length === 0) {
		return { entityId: null, entityType: null };
	}

	const first = (segments[0] ?? "").slice(0, MAX_ENTITY_TYPE_LENGTH) || null;
	const second = segments[1] ?? null;

	if (second && UUID_OR_ID_SEGMENT_REGEX.test(second)) {
		return { entityType: first, entityId: second };
	}

	return { entityType: first, entityId: null };
}

function methodToVerb(method: string): string {
	switch (method) {
		case "POST":
			return "create";
		case "PUT":
		case "PATCH":
			return "update";
		case "DELETE":
			return "delete";
		case "GET":
			return "read";
		default:
			return method.toLowerCase();
	}
}

interface SessionActor {
	activeOrganizationId?: string | null;
	userId?: string | null;
}

interface UserActor {
	id?: string | null;
}

function resolveAuditAction(params: {
	entityType: string | null;
	method: string;
	scope: string;
	securityEvent: TenantMismatchSecurityEvent | null;
	sensitiveRead: boolean;
	status: number;
}): string | null {
	const { entityType, method, scope, securityEvent, sensitiveRead, status } =
		params;

	if (securityEvent?.reason === "CROSS_TENANT_MISMATCH") {
		return "security.cross_tenant_mismatch";
	}
	if (ACCESS_DENIED_STATUSES.has(status)) {
		return "security.access_denied";
	}
	if (WRITE_METHODS.has(method)) {
		return `${scope}.${entityType ?? "resource"}.${methodToVerb(method)}`;
	}
	if (sensitiveRead) {
		return `${scope}.${entityType ?? "resource"}.read`;
	}
	return null;
}

export function createAccessAuditMiddleware(
	options: AccessAuditMiddlewareOptions = {}
): MiddlewareHandler<AppEnv> {
	const scope = options.scope ?? "app";
	const sensitivePrefixes =
		options.sensitivePrefixes ?? DEFAULT_SENSITIVE_READ_PREFIXES;
	const writer = options.writeAuditLog ?? persistAuditLog;

	return createMiddleware<AppEnv>(async (c, next) => {
		const startedAt = Date.now();
		await next();
		const durationMs = Date.now() - startedAt;

		const method = c.req.method.toUpperCase();
		const { status } = c.res;
		const sanitizedPath = sanitizeRequestPath(c.req.path);
		const requestId = c.get("requestId");
		const securityEvent =
			(c.get("securityEvent") as TenantMismatchSecurityEvent | undefined) ??
			null;

		if (status === 404 && !securityEvent) {
			return;
		}

		const { entityType, entityId } = extractEntityFromPath(sanitizedPath);
		const sensitiveRead =
			method === "GET" && isSensitiveReadPath(sanitizedPath, sensitivePrefixes);

		const action = resolveAuditAction({
			entityType,
			method,
			scope,
			securityEvent,
			sensitiveRead,
			status,
		});

		if (!action) {
			return;
		}

		const session = c.get("session") as SessionActor | null | undefined;
		const user = c.get("user") as UserActor | null | undefined;

		const record: AuditLogRecord = {
			action: action.slice(0, MAX_ACTION_LENGTH),
			details: {
				durationMs,
				method,
				path: sanitizedPath,
				...(requestId ? { requestId } : {}),
				status,
			},
			entityId,
			entityType,
			ipAddress: extractClientIp(c),
			organizationId: session?.activeOrganizationId ?? null,
			userAgent: c.req.header("user-agent") ?? null,
			userId: user?.id ?? session?.userId ?? null,
		};

		const writePromise = Promise.resolve()
			.then(() => writer(record))
			.catch((error) => {
				logError("AuditMiddleware", error, {
					action: record.action,
					requestId,
				});
			})
			.finally(() => {
				pendingAuditWrites.delete(writePromise);
			});

		pendingAuditWrites.add(writePromise);
	});
}

export const auditMiddleware = createAccessAuditMiddleware();
