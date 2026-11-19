import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { type AppEnv, createErrorResponse } from "../lib/create-hono-app";
import type { TenantMismatchSecurityEvent } from "../lib/tenant";

const JSON_CONTENT_TYPE_REGEX = /application\/json/iu;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_INSPECT_BODY_BYTES = 1_048_576; // 1 MB safety cap

function findOrgIdInValue(value: unknown, depth = 0): string | undefined {
	if (depth > 3 || !value || typeof value !== "object") {
		return undefined;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const nested = findOrgIdInValue(item, depth + 1);
			if (nested !== undefined) {
				return nested;
			}
		}
		return undefined;
	}

	const record = value as Record<string, unknown>;
	for (const key of ["organizationId", "orgId"] as const) {
		const raw = record[key];
		if (typeof raw === "string") {
			return raw;
		}
	}

	for (const val of Object.values(record)) {
		if (val && typeof val === "object") {
			const nested = findOrgIdInValue(val, depth + 1);
			if (nested !== undefined) {
				return nested;
			}
		}
	}

	return undefined;
}

async function extractBodyOrganizationId(
	req: Request
): Promise<string | undefined> {
	const contentType = req.headers.get("content-type") ?? "";
	if (!JSON_CONTENT_TYPE_REGEX.test(contentType)) {
		return undefined;
	}

	const contentLengthHeader = req.headers.get("content-length");
	if (contentLengthHeader) {
		const contentLength = Number(contentLengthHeader);
		if (
			Number.isFinite(contentLength) &&
			contentLength > MAX_INSPECT_BODY_BYTES
		) {
			return undefined;
		}
	}

	try {
		const cloned = req.clone();
		const text = await cloned.text();
		if (text.length > MAX_INSPECT_BODY_BYTES) {
			return undefined;
		}
		const parsed: unknown = JSON.parse(text);
		return findOrgIdInValue(parsed);
	} catch {
		// Ignore malformed JSON; downstream schema validator will handle it
	}

	return undefined;
}

function extractMismatchedOrgFromRequest(
	activeOrgId: string,
	candidates: Array<{
		source: TenantMismatchSecurityEvent["source"];
		value: string | undefined;
	}>
): TenantMismatchSecurityEvent | null {
	for (const candidate of candidates) {
		const trimmed = candidate.value?.trim();
		if (trimmed && trimmed !== activeOrgId) {
			return {
				activeOrganizationId: activeOrgId,
				attemptedOrganizationId: trimmed,
				reason: "CROSS_TENANT_MISMATCH",
				source: candidate.source,
			};
		}
	}
	return null;
}

export interface TenantBoundaryMiddlewareOptions {
	onMismatch?: (
		c: Context<AppEnv>,
		event: TenantMismatchSecurityEvent
	) => void | Promise<void>;
}

/**
 * Middleware that guarantees `organizationId`/`orgId` always matches `session.activeOrganizationId`
 * and rejects any request attempting to pass a mismatched tenant identifier in query,
 * route params, headers, or JSON body.
 */
export function createTenantBoundaryMiddleware(
	options: TenantBoundaryMiddlewareOptions = {}
): MiddlewareHandler<AppEnv> {
	return createMiddleware<AppEnv>(async (c, next) => {
		const session = c.get("session");
		const activeOrgId = session?.activeOrganizationId?.trim();

		if (!activeOrgId) {
			await next();
			return;
		}

		let bodyOrgId: string | undefined;
		if (MUTATION_METHODS.has(c.req.method.toUpperCase())) {
			bodyOrgId = await extractBodyOrganizationId(c.req.raw);
		}

		const mismatch = extractMismatchedOrgFromRequest(activeOrgId, [
			{ source: "query", value: c.req.query("organizationId") },
			{ source: "query", value: c.req.query("orgId") },
			{ source: "param", value: c.req.param("orgId") },
			{ source: "param", value: c.req.param("organizationId") },
			{ source: "header", value: c.req.header("x-organization-id") },
			{ source: "body", value: bodyOrgId },
		]);

		if (mismatch) {
			if (options.onMismatch) {
				await options.onMismatch(c, mismatch);
			}

			return c.json(
				createErrorResponse(
					"ForbiddenError",
					"Cross-tenant access denied: organizationId does not match active organization",
					[
						{
							code: "CROSS_TENANT_ACCESS_DENIED",
							message:
								"Provided organizationId does not match the active organization session",
							path: ["organizationId"],
						},
					]
				),
				403
			);
		}

		await next();
	});
}

export const tenantBoundaryMiddleware = createTenantBoundaryMiddleware({
	onMismatch: (c, event) => {
		c.set("securityEvent", event);
	},
});
