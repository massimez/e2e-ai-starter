import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
	queryValidator,
	requireUser,
} from "../../../lib/create-hono-app";
import { requireJsonContentType } from "../../../middleware/request-guards";
import {
	grantCreditsSchema,
	requireWalletOperationId,
	reverseChargeBodySchema,
	reverseChargeParamSchema,
	walletChargeLookupSchema,
} from "../../wallet/schema";
import { walletService } from "../../wallet/service";
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
	.get(
		"/:organizationId/wallet/charges",
		paramValidator(organizationIdParamSchema),
		queryValidator(walletChargeLookupSchema),
		async (c) => {
			const { organizationId } = c.req.valid("param");
			const { requestId } = c.req.valid("query");
			c.set("auditMeta", {
				action: "admin.organization.wallet_charge_lookup",
				details: { lookupRequestId: requestId },
				entityId: organizationId,
				entityType: "organization",
				organizationId,
			});
			return c.json(
				createSuccessResponse(
					await walletService.findChargesByRequestId(organizationId, requestId)
				)
			);
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
	)
	.post(
		"/:organizationId/wallet/grants",
		requireJsonContentType,
		paramValidator(organizationIdParamSchema),
		jsonValidator(grantCreditsSchema),
		async (c) => {
			const { organizationId } = c.req.valid("param");
			const body = c.req.valid("json");
			c.set("auditMeta", {
				action: "admin.organization.wallet_grant",
				details: { credits: body.credits, reason: body.reason },
				entityId: organizationId,
				entityType: "organization",
				organizationId,
			});
			const operationId = requireWalletOperationId(
				c.req.header("Idempotency-Key")
			);
			const result = await walletService.grantCredits({
				...body,
				actorId: requireUser(c).id,
				operationId,
				organizationId,
			});
			c.set("auditMeta", {
				action: "admin.organization.wallet_grant",
				details: {
					applied: result.applied,
					credits: body.credits,
					operationId,
					reason: body.reason,
				},
				entityId: result.entryId,
				entityType: "wallet_entry",
				organizationId,
			});
			return c.json(createSuccessResponse(result));
		}
	)
	.post(
		"/:organizationId/wallet/charges/:entryId/reverse",
		requireJsonContentType,
		paramValidator(reverseChargeParamSchema),
		jsonValidator(reverseChargeBodySchema),
		async (c) => {
			const { entryId, organizationId } = c.req.valid("param");
			const body = c.req.valid("json");
			c.set("auditMeta", {
				action: "admin.organization.wallet_charge_reversal",
				details: { reason: body.reason },
				entityId: entryId,
				entityType: "wallet_entry",
				organizationId,
			});
			const result = await walletService.reverseCharge({
				...body,
				actorId: requireUser(c).id,
				entryId,
				organizationId,
			});
			c.set("auditMeta", {
				action: "admin.organization.wallet_charge_reversal",
				details: {
					applied: result.applied,
					credits: result.credits,
					reason: body.reason,
					reversalEntryId: result.entryId,
				},
				entityId: entryId,
				entityType: "wallet_entry",
				organizationId,
			});
			return c.json(createSuccessResponse(result));
		}
	);
