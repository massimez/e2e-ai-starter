import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
} from "../../lib/create-hono-app";
import { getActiveOrgContext } from "../../lib/tenant";
import { hasOrgPermission } from "../../middleware/org-permission";
import {
	cloneOrganizationRoleSchema,
	createOrganizationRoleSchema,
	memberIdParamSchema,
	roleIdParamSchema,
	updateMemberRoleSchema,
	updateOrganizationRoleSchema,
} from "./schema";
import { rolesService } from "./service";

export const roleRoutes = createRouter()
	.get("/permissions", hasOrgPermission("role:read"), (c) =>
		c.json(createSuccessResponse(rolesService.getPermissionCatalog()))
	)
	.get("/me", async (c) => {
		const { organizationId, userId } = getActiveOrgContext(c);
		const effective = await rolesService.getUserEffectivePermissions(
			organizationId,
			userId
		);
		return c.json(createSuccessResponse(effective));
	})
	.get("/", async (c) => {
		const { organizationId, userId } = getActiveOrgContext(c);
		await rolesService.assertOrganizationMember(organizationId, userId);
		const orgRoles = await rolesService.listOrganizationRoles(organizationId);
		return c.json(createSuccessResponse(orgRoles));
	})
	.post(
		"/",
		hasOrgPermission("role:create"),
		jsonValidator(createOrganizationRoleSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const created = await rolesService.createOrganizationRole(
				organizationId,
				input,
				userId
			);
			return c.json(createSuccessResponse(created, "Role created"), 201);
		}
	)
	.put(
		"/:id",
		hasOrgPermission("role:update"),
		paramValidator(roleIdParamSchema),
		jsonValidator(updateOrganizationRoleSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const input = c.req.valid("json");
			const updated = await rolesService.updateOrganizationRole(
				organizationId,
				id,
				input,
				userId
			);
			return c.json(createSuccessResponse(updated, "Role updated"));
		}
	)
	.delete(
		"/:id",
		hasOrgPermission("role:delete"),
		paramValidator(roleIdParamSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const result = await rolesService.deleteOrganizationRole(
				organizationId,
				id,
				userId
			);
			return c.json(createSuccessResponse(result, "Role deleted"));
		}
	)
	.post(
		"/:id/clone",
		hasOrgPermission("role:create"),
		paramValidator(roleIdParamSchema),
		jsonValidator(cloneOrganizationRoleSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const input = c.req.valid("json");
			const cloned = await rolesService.cloneOrganizationRole(
				organizationId,
				id,
				input,
				userId
			);
			return c.json(createSuccessResponse(cloned, "Role cloned"), 201);
		}
	)
	.patch(
		"/members/:memberId",
		hasOrgPermission("role:assign"),
		paramValidator(memberIdParamSchema),
		jsonValidator(updateMemberRoleSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { memberId } = c.req.valid("param");
			const { roleSlug } = c.req.valid("json");
			const updatedMember = await rolesService.updateOrganizationMemberRole(
				organizationId,
				memberId,
				roleSlug,
				userId
			);
			return c.json(
				createSuccessResponse(updatedMember, "Member role updated")
			);
		}
	);
