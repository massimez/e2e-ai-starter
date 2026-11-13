import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	requireUser,
} from "../../lib/create-hono-app";
import { NotFoundError } from "../../lib/errors";
import { getActiveOrgContext } from "../../lib/tenant";
import { authMiddleware } from "../../middleware/auth";
import { hasOrgPermission } from "../../middleware/org-permission";
import { rateLimiter } from "../../middleware/rate-limiter";
import { tenantBoundaryMiddleware } from "../../middleware/tenant-boundary";
import { resolveSessionOrganizationOnConnect } from "./default-organization";
import { transferOwnershipSchema } from "./schema";
import {
	getOrganizationById,
	getUserOrganizations,
	transferOwnership,
} from "./service";

export const organizationRoutes = createRouter()
	// All routes in this module require an active authenticated user & tenant boundary check
	.use(
		"*",
		authMiddleware,
		rateLimiter(60_000, 120, { identity: "actor" }),
		tenantBoundaryMiddleware
	)

	// List user's organizations
	.get("/", async (c) => {
		const user = requireUser(c);
		const orgs = await getUserOrganizations(user.id);
		return c.json(createSuccessResponse(orgs));
	})

	// Resolve persisted default organization (falling back to earliest membership if needed)
	.get("/default", async (c) => {
		const user = requireUser(c);
		const defaultOrganizationId = await resolveSessionOrganizationOnConnect({
			userId: user.id,
		});
		return c.json(createSuccessResponse({ defaultOrganizationId }));
	})

	// Get current active organization details
	.get("/current", hasOrgPermission("setting:read"), async (c) => {
		const { organizationId } = getActiveOrgContext(c);
		const org = await getOrganizationById(organizationId);
		if (!org) {
			throw new NotFoundError("Organization");
		}
		return c.json(createSuccessResponse(org));
	})

	// Transfer organization ownership atomically from current owner to an active admin
	.post(
		"/transfer-ownership",
		hasOrgPermission("organization:update"),
		jsonValidator(transferOwnershipSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await transferOwnership({
				currentOwnerUserId: userId,
				newOwnerUserId: input.newOwnerUserId,
				organizationId,
			});
			return c.json(
				createSuccessResponse(result, "Organization ownership transferred")
			);
		}
	);
