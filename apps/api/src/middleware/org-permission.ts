import { createMiddleware } from "hono/factory";
import { type AppEnv, createErrorResponse } from "../lib/create-hono-app";
import { rolesService } from "../modules/roles/service";

export function hasOrgPermission(requiredPermission: string) {
	return createMiddleware<AppEnv>(async (c, next) => {
		const session = c.get("session");
		const user = c.get("user");
		const organizationId = session?.activeOrganizationId;
		const userId = user?.id;

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

		if (!userId) {
			return c.json(
				createErrorResponse("Unauthorized", "Authentication required"),
				401
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

		const allowed = await rolesService.userHasOrganizationPermission({
			organizationId,
			permission: requiredPermission,
			userId,
		});

		if (!allowed) {
			return c.json(
				createErrorResponse(
					"Forbidden",
					`You do not have permission to ${action} ${resource}`
				),
				403
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
