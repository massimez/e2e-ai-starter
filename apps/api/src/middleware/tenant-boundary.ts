import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { type AppEnv, createErrorResponse } from "../lib/create-hono-app";
import type { TenantMismatchSecurityEvent } from "../lib/tenant";

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
 * Middleware that guarantees explicit `organizationId`/`orgId` parameters and
 * `x-organization-id` headers match `session.activeOrganizationId`.
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

		const mismatch = extractMismatchedOrgFromRequest(activeOrgId, [
			{ source: "query", value: c.req.query("organizationId") },
			{ source: "query", value: c.req.query("orgId") },
			{ source: "param", value: c.req.param("orgId") },
			{ source: "param", value: c.req.param("organizationId") },
			{ source: "header", value: c.req.header("x-organization-id") },
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
