import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
	queryValidator,
} from "../../../lib/create-hono-app";
import {
	listAdminOrganizationsQuerySchema,
	organizationIdParamSchema,
	updateStorageLimitBodySchema,
} from "./schema";
import { adminOrganizationsService } from "./service";

/** Organization management sub-routes mounted under `/api/admin/organizations`. */
export const adminOrganizationsRoutes = createRouter()
	.get("/", queryValidator(listAdminOrganizationsQuerySchema), async (c) => {
		const result = await adminOrganizationsService.listOrganizations(
			c.req.valid("query")
		);
		return c.json(createSuccessResponse(result));
	})
	.get(
		"/:organizationId",
		paramValidator(organizationIdParamSchema),
		async (c) => {
			const { organizationId } = c.req.valid("param");
			const result =
				await adminOrganizationsService.getOrganizationDetail(organizationId);
			return c.json(createSuccessResponse(result));
		}
	)
	.patch(
		"/:organizationId/storage-limit",
		paramValidator(organizationIdParamSchema),
		jsonValidator(updateStorageLimitBodySchema),
		async (c) => {
			const { organizationId } = c.req.valid("param");
			const body = c.req.valid("json");
			const result = await adminOrganizationsService.updateStorageLimit({
				body,
				organizationId,
			});
			c.set("auditMeta", {
				action: "admin.organization.storage_limit_update",
				details: { storageLimitBytes: body.storageLimitBytes },
				entityId: organizationId,
				entityType: "organization",
				organizationId,
			});
			return c.json(createSuccessResponse(result));
		}
	);
