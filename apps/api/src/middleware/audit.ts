import {
	logError,
	logWarning,
	sanitizeRequestPath,
} from "@workspace/shared/logger";
import { withTimeout } from "@workspace/shared/queues";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import {
	API_PREFIX_REGEX,
	type AuditLogRecord,
	type AuditLogWriter,
	DEFAULT_SENSITIVE_READ_PREFIXES,
	isSensitiveReadPath,
	MAX_ACTION_LENGTH,
	MAX_ENTITY_TYPE_LENGTH,
	persistAuditLog,
} from "../lib/audit";
import { auth } from "../lib/auth/index";
import type { AppEnv, AuditMetaOverride } from "../lib/create-hono-app";
import { extractClientIp } from "../lib/ip";
import type { TenantMismatchSecurityEvent } from "../lib/tenant";

interface SessionActor {
	activeOrganizationId?: string | null;
	impersonatedBy?: string | null;
	userId?: string | null;
}

interface UserActor {
	id?: string | null;
}

export type AuditSessionResolver = (
	headers: Headers
) => Promise<{ session?: SessionActor | null; user?: UserActor | null } | null>;

export interface AccessAuditMiddlewareOptions {
	maxPendingWrites?: number;
	resolveSession?: AuditSessionResolver;
	scope?: string;
	sensitivePrefixes?: readonly string[];
	writeAuditLog?: AuditLogWriter;
}

const DEFAULT_MAX_PENDING_AUDIT_WRITES = 500;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ACCESS_DENIED_STATUSES = new Set([401, 403, 423]);
const UUID_OR_ID_SEGMENT_REGEX =
	/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{16,}|\d+)$/iu;

const PRE_CAPTURE_SESSION_SUFFIXES = [
	"/sign-out",
	"/admin/stop-impersonating",
	"/revoke-session",
	"/revoke-sessions",
	"/delete-user",
] as const;

const pendingAuditWrites = new Set<Promise<void>>();

export async function drainAuditLogs(timeoutMs = 3000): Promise<void> {
	if (pendingAuditWrites.size === 0) {
		return;
	}
	await withTimeout(
		Promise.allSettled(Array.from(pendingAuditWrites)),
		timeoutMs,
		"Audit log drain timed out"
	).catch(() => undefined);
}

function shouldPreCaptureSession(method: string, path: string): boolean {
	if (method !== "POST") {
		return false;
	}
	for (const suffix of PRE_CAPTURE_SESSION_SUFFIXES) {
		if (path.endsWith(suffix)) {
			return true;
		}
	}
	return false;
}

function isPlatformAdminPath(path: string): boolean {
	return path === "/api/admin" || path.startsWith("/api/admin/");
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

	for (let index = 1; index < segments.length; index += 1) {
		const segment = segments[index];
		if (segment && UUID_OR_ID_SEGMENT_REGEX.test(segment)) {
			const entityType =
				segments.slice(0, index).join("/").slice(0, MAX_ENTITY_TYPE_LENGTH) ||
				null;
			return { entityId: segment, entityType };
		}
	}

	return {
		entityId: null,
		entityType: segments.join("/").slice(0, MAX_ENTITY_TYPE_LENGTH) || null,
	};
}

function methodToVerb(method: string): string {
	switch (method) {
		case "POST":
			return "create";
		case "PUT":
			return "update";
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

function resolveAuditAction(params: {
	auditMeta: AuditMetaOverride | undefined;
	entityType: string | null;
	method: string;
	scope: string;
	securityEvent: TenantMismatchSecurityEvent | null;
	sensitiveRead: boolean;
	status: number;
}): string | null {
	const {
		auditMeta,
		entityType,
		method,
		scope,
		securityEvent,
		sensitiveRead,
		status,
	} = params;

	if (securityEvent?.reason === "CROSS_TENANT_MISMATCH") {
		return "security.cross_tenant_mismatch";
	}
	if (ACCESS_DENIED_STATUSES.has(status)) {
		return "security.access_denied";
	}
	if (auditMeta?.action) {
		return auditMeta.action;
	}
	if (WRITE_METHODS.has(method)) {
		return `${scope}.${entityType ?? "resource"}.${methodToVerb(method)}`;
	}
	if (sensitiveRead) {
		return `${scope}.${entityType ?? "resource"}.read`;
	}
	return null;
}

const defaultSessionResolver: AuditSessionResolver = async (headers) => {
	const resolved = await auth.api.getSession({
		headers,
		query: { disableCookieCache: true },
	});
	if (!resolved) {
		return null;
	}
	return {
		session: resolved.session as SessionActor,
		user: resolved.user as UserActor,
	};
};

async function safeResolveSession(
	resolver: AuditSessionResolver,
	headers: Headers
): Promise<{ session?: SessionActor | null; user?: UserActor | null } | null> {
	if (!(headers.has("cookie") || headers.has("authorization"))) {
		return null;
	}
	try {
		return await resolver(headers);
	} catch {
		return null;
	}
}

async function resolveActorContext(params: {
	contextSession: SessionActor | null | undefined;
	contextUser: UserActor | null | undefined;
	headers: Headers;
	preCapturedActor: {
		session?: SessionActor | null;
		user?: UserActor | null;
	} | null;
	sessionResolver: AuditSessionResolver;
}): Promise<{
	session: SessionActor | null | undefined;
	user: UserActor | null | undefined;
}> {
	if (params.contextUser?.id || params.contextSession?.userId) {
		return { session: params.contextSession, user: params.contextUser };
	}

	if (params.preCapturedActor) {
		return {
			session: params.preCapturedActor.session ?? params.contextSession,
			user: params.preCapturedActor.user ?? params.contextUser,
		};
	}

	// Only fall back when authMiddleware did NOT run (`undefined`, e.g. `/api/auth/*`).
	// If authMiddleware already ran and rejected with 401 (`null`), skip redundant lookups.
	if (params.contextSession !== undefined || params.contextUser !== undefined) {
		return { session: params.contextSession, user: params.contextUser };
	}

	const fallback = await safeResolveSession(
		params.sessionResolver,
		params.headers
	);

	return {
		session: fallback?.session ?? null,
		user: fallback?.user ?? null,
	};
}

function resolveOrganizationId(params: {
	auditMeta: AuditMetaOverride | undefined;
	sanitizedPath: string;
	session: SessionActor | null | undefined;
}): string | null {
	if (params.auditMeta && "organizationId" in params.auditMeta) {
		return params.auditMeta.organizationId ?? null;
	}
	// Platform backoffice routes must never inherit the operator's unrelated workspace.
	if (isPlatformAdminPath(params.sanitizedPath)) {
		return null;
	}
	return params.session?.activeOrganizationId ?? null;
}

export function createAccessAuditMiddleware(
	options: AccessAuditMiddlewareOptions = {}
): MiddlewareHandler<AppEnv> {
	const scope = options.scope ?? "app";
	const sensitivePrefixes =
		options.sensitivePrefixes ?? DEFAULT_SENSITIVE_READ_PREFIXES;
	const writer = options.writeAuditLog ?? persistAuditLog;
	const sessionResolver = options.resolveSession ?? defaultSessionResolver;
	const maxPendingWrites =
		options.maxPendingWrites ?? DEFAULT_MAX_PENDING_AUDIT_WRITES;

	return createMiddleware<AppEnv>(async (c, next) => {
		const method = c.req.method.toUpperCase();
		const sanitizedPath = sanitizeRequestPath(c.req.path);

		// Session-invalidating auth endpoints delete the session during next(), so capture actor first.
		const preCapturedActor = shouldPreCaptureSession(method, sanitizedPath)
			? await safeResolveSession(sessionResolver, c.req.raw.headers)
			: null;

		const startedAt = Date.now();
		await next();
		const durationMs = Date.now() - startedAt;

		const { status } = c.res;
		const requestId = c.get("requestId");
		const auditMeta = c.get("auditMeta");
		const securityEvent =
			(c.get("securityEvent") as TenantMismatchSecurityEvent | undefined) ??
			null;

		if (status === 404 && !securityEvent) {
			return;
		}

		const extracted = extractEntityFromPath(sanitizedPath);
		const entityType = auditMeta?.entityType ?? extracted.entityType;
		const entityId =
			auditMeta && "entityId" in auditMeta
				? (auditMeta.entityId ?? null)
				: extracted.entityId;
		const sensitiveRead =
			method === "GET" && isSensitiveReadPath(sanitizedPath, sensitivePrefixes);

		const action = resolveAuditAction({
			auditMeta,
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

		if (pendingAuditWrites.size >= maxPendingWrites) {
			logWarning(
				"AuditMiddleware",
				"Dropped audit log write due to pending queue saturation",
				{
					action: action.slice(0, MAX_ACTION_LENGTH),
					pendingWrites: pendingAuditWrites.size,
					requestId,
				}
			);
			return;
		}

		const contextSession = c.get("session") as SessionActor | null | undefined;
		const contextUser = c.get("user") as UserActor | null | undefined;
		const requestHeaders = new Headers(c.req.raw.headers);
		const ipAddress = extractClientIp(c);
		const userAgent = c.req.header("user-agent") ?? null;

		const writePromise = Promise.resolve()
			.then(async () => {
				const { session, user } = await resolveActorContext({
					contextSession,
					contextUser,
					headers: requestHeaders,
					preCapturedActor,
					sessionResolver,
				});

				const record: AuditLogRecord = {
					action: action.slice(0, MAX_ACTION_LENGTH),
					details: {
						...auditMeta?.details,
						durationMs,
						...(session?.impersonatedBy
							? { impersonatedBy: session.impersonatedBy }
							: {}),
						method,
						path: sanitizedPath,
						...(requestId ? { requestId } : {}),
						status,
					},
					entityId,
					entityType,
					ipAddress,
					organizationId: resolveOrganizationId({
						auditMeta,
						sanitizedPath,
						session,
					}),
					userAgent,
					userId: user?.id ?? session?.userId ?? null,
				};

				await writer(record);
			})
			.catch((error) => {
				logError("AuditMiddleware", error, {
					action: action.slice(0, MAX_ACTION_LENGTH),
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
