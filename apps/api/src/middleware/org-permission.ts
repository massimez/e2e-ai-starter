import { APIError } from "better-auth/api";
import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth/index";
import { type AppEnv, createErrorResponse } from "../lib/create-hono-app";

async function verifyOrgPermissionWithBetterAuth(params: {
	action: string;
	headers: Headers;
	organizationId: string;
	resource: string;
}): Promise<{ ok: true } | { message: string; ok: false; status: 401 | 403 }> {
	const { action, headers, organizationId, resource } = params;

	let result: { error?: unknown; success?: boolean };
	try {
		result = await auth.api.hasPermission({
			body: {
				organizationId,
				permissions: {
					[resource]: [action],
				},
			},
			headers,
		});
	} catch (error) {
		if (error instanceof APIError) {
			if (error.statusCode === 401) {
				return {
					message: error.message || "Authentication or membership required",
					ok: false,
					status: 401,
				};
			}
			if (error.statusCode === 403) {
				return {
					message: `You do not have permission to ${action} ${resource}`,
					ok: false,
					status: 403,
				};
			}
		}
		throw error;
	}

	if (!result.success || result.error) {
		return {
			message: `You do not have permission to ${action} ${resource}`,
			ok: false,
			status: 403,
		};
	}

	return { ok: true };
}

export function hasOrgPermission(requiredPermission: string) {
	return createMiddleware<AppEnv>(async (c, next) => {
		const session = c.get("session");
		const organizationId = session?.activeOrganizationId;

		if (!organizationId) {
			return c.json(
				createErrorResponse(
					"ValidationError",
					"No active organization selected",
					[
						{
							code: "MISSING_ORG_ID",
							message: "Active organization required",
							path: ["organizationId"],
						},
					]
				),
				400
			);
		}

		const [resource, action] = requiredPermission.split(":");
		if (!(resource && action)) {
			return c.json(
				createErrorResponse(
					"ValidationError",
					"Invalid permission format (expected resource:action)",
					[
						{
							code: "INVALID_PERMISSION",
							message: "Must be in format resource:action",
							path: ["permission"],
						},
					]
				),
				400
			);
		}

		let cache = c.get("permissionCache");
		if (cache?.has(requiredPermission)) {
			await next();
			return;
		}

		const verification = await verifyOrgPermissionWithBetterAuth({
			action,
			headers: c.req.raw.headers,
			organizationId,
			resource,
		});

		if (!verification.ok) {
			return c.json(
				createErrorResponse(
					verification.status === 401 ? "Unauthorized" : "Forbidden",
					verification.message
				),
				verification.status
			);
		}

		if (!cache) {
			cache = new Set<string>();
			c.set("permissionCache", cache);
		}
		cache.add(requiredPermission);

		await next();
	});
}
