import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
	queryValidator,
	requireUser,
} from "../../../lib/create-hono-app";
import {
	banUserBodySchema,
	listAdminUsersQuerySchema,
	updateUserRoleBodySchema,
	userIdParamSchema,
	userSessionParamSchema,
} from "./schema";
import { adminUsersService } from "./service";

/** User management sub-routes mounted under `/api/admin/users`. */
export const adminUsersRoutes = createRouter()
	.get("/", queryValidator(listAdminUsersQuerySchema), async (c) => {
		const result = await adminUsersService.listUsers(c.req.valid("query"));
		return c.json(createSuccessResponse(result));
	})
	.get("/:userId", paramValidator(userIdParamSchema), async (c) => {
		const { userId } = c.req.valid("param");
		const result = await adminUsersService.getUserDetail(userId);
		return c.json(createSuccessResponse(result));
	})
	.patch(
		"/:userId/role",
		paramValidator(userIdParamSchema),
		jsonValidator(updateUserRoleBodySchema),
		async (c) => {
			const actor = requireUser(c);
			const { userId } = c.req.valid("param");
			const body = c.req.valid("json");
			const { previousRole, user: updated } =
				await adminUsersService.updateUserRole({
					actorId: actor.id,
					body,
					userId,
				});
			c.set("auditMeta", {
				action: "admin.user.role_change",
				details: { nextRole: body.role, previousRole },
				entityId: userId,
				entityType: "user",
				organizationId: null,
			});
			return c.json(createSuccessResponse(updated));
		}
	)
	.post(
		"/:userId/ban",
		paramValidator(userIdParamSchema),
		jsonValidator(banUserBodySchema),
		async (c) => {
			const actor = requireUser(c);
			const { userId } = c.req.valid("param");
			const body = c.req.valid("json");
			const updated = await adminUsersService.banUser({
				actorId: actor.id,
				body,
				userId,
			});
			c.set("auditMeta", {
				action: "admin.user.ban",
				details: {
					banExpires: updated.banExpires?.toISOString() ?? null,
					reason: body.reason,
				},
				entityId: userId,
				entityType: "user",
				organizationId: null,
			});
			return c.json(createSuccessResponse(updated));
		}
	)
	.post("/:userId/unban", paramValidator(userIdParamSchema), async (c) => {
		const { userId } = c.req.valid("param");
		const updated = await adminUsersService.unbanUser(userId);
		c.set("auditMeta", {
			action: "admin.user.unban",
			entityId: userId,
			entityType: "user",
			organizationId: null,
		});
		return c.json(createSuccessResponse(updated));
	})
	.delete(
		"/:userId/sessions/:sessionId",
		paramValidator(userSessionParamSchema),
		async (c) => {
			const actor = requireUser(c);
			const { sessionId, userId } = c.req.valid("param");
			const result = await adminUsersService.revokeUserSession({
				actorId: actor.id,
				currentSessionId: c.get("session")?.id ?? null,
				sessionId,
				userId,
			});
			c.set("auditMeta", {
				action: "admin.user.session_revoke",
				details: { sessionId },
				entityId: userId,
				entityType: "session",
				organizationId: null,
			});
			return c.json(createSuccessResponse(result));
		}
	)
	.delete("/:userId/sessions", paramValidator(userIdParamSchema), async (c) => {
		const actor = requireUser(c);
		const { userId } = c.req.valid("param");
		const result = await adminUsersService.revokeAllUserSessions({
			actorId: actor.id,
			userId,
		});
		c.set("auditMeta", {
			action: "admin.user.sessions_revoke_all",
			details: { revokedCount: result.revokedCount },
			entityId: userId,
			entityType: "session",
			organizationId: null,
		});
		return c.json(createSuccessResponse(result));
	});
