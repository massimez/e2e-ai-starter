import { db } from "@workspace/db";
import { member } from "@workspace/db/schema";
import { parseMemberRoles } from "@workspace/shared/permissions";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth/index";
import { type AppEnv, createErrorResponse } from "../lib/create-hono-app";

function extractOrgActorOrErrorResponse(
	c: Context<AppEnv>
):
	| { ok: true; organizationId: string; userId: string }
	| { ok: false; response: Response } {
	const session = c.get("session");
	const user = c.get("user");
	const organizationId = session?.activeOrganizationId;
	const userId = user?.id;

	if (!organizationId) {
		return {
			ok: false,
			response: c.json(
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
			),
		};
	}

	if (!userId) {
		return {
			ok: false,
			response: c.json(
				createErrorResponse("Unauthorized", "Authentication required"),
				401
			),
		};
	}

	return { ok: true, organizationId, userId };
}

export function hasOrgPermission(requiredPermission: string) {
	return createMiddleware<AppEnv>(async (c, next) => {
		const actor = extractOrgActorOrErrorResponse(c);
		if (!actor.ok) {
			return actor.response;
		}
		const { organizationId } = actor;

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

		let allowed = false;
		try {
			const result = await auth.api.hasPermission({
				body: {
					organizationId,
					permissions: {
						[resource]: [action],
					},
				},
				headers: c.req.raw.headers,
			});
			allowed = Boolean(result?.success);
		} catch {
			allowed = false;
		}

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

export function requireOrgOwner() {
	return createMiddleware<AppEnv>(async (c, next) => {
		const actor = extractOrgActorOrErrorResponse(c);
		if (!actor.ok) {
			return actor.response;
		}

		const [membership] = await db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.organizationId, actor.organizationId),
					eq(member.userId, actor.userId)
				)
			)
			.limit(1);

		const isOwner = parseMemberRoles(membership?.role).includes("owner");
		if (!isOwner) {
			return c.json(
				createErrorResponse(
					"Forbidden",
					"Only the organization owner can perform this action"
				),
				403
			);
		}

		await next();
	});
}
