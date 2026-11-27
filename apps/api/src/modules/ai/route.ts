import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
	queryValidator,
} from "../../lib/create-hono-app";
import { getActiveOrgContext } from "../../lib/tenant";
import { authMiddleware } from "../../middleware/auth";
import { hasOrgPermission } from "../../middleware/org-permission";
import { rateLimiter } from "../../middleware/rate-limiter";
import {
	requireJsonContentType,
	requireNonImpersonatedSession,
	requireTrustedOrigin,
} from "../../middleware/request-guards";
import { tenantBoundaryMiddleware } from "../../middleware/tenant-boundary";
import {
	requireWalletOperationId,
	walletOperationParamSchema,
} from "../wallet/schema";
import { walletService } from "../wallet/service";
import {
	aiChatRequestSchema,
	aiThreadIdParamSchema,
	listAiThreadsQuerySchema,
	workspaceBriefRequestSchema,
} from "./schema";
import { aiService } from "./service";

export const aiRoutes = createRouter()
	.use(
		"*",
		authMiddleware,
		tenantBoundaryMiddleware,
		rateLimiter(60_000, 120, { identity: "actor" })
	)
	.get("/agents", hasOrgPermission("ai:read"), (c) => {
		const agents = aiService.listAiAgents();
		return c.json(createSuccessResponse(agents));
	})
	.get(
		"/operations/:operationId",
		hasOrgPermission("ai:execute"),
		paramValidator(walletOperationParamSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { operationId } = c.req.valid("param");
			c.header("Cache-Control", "no-store");
			return c.json(
				createSuccessResponse(
					await walletService.getAiChargeStatus({
						actorId: userId,
						operationId,
						organizationId,
					})
				)
			);
		}
	)
	.post(
		"/chat",
		hasOrgPermission("ai:execute"),
		rateLimiter(60_000, 30, { identity: "actor", operation: "ai:chat" }),
		requireNonImpersonatedSession,
		requireTrustedOrigin,
		requireJsonContentType,
		jsonValidator(aiChatRequestSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			return await aiService.createAiChatResponse({
				abortSignal: c.req.raw.signal,
				headers: c.req.raw.headers,
				input,
				organizationId,
				requestId: c.get("requestId"),
				userId,
			});
		}
	)
	.get(
		"/threads",
		hasOrgPermission("ai:read"),
		queryValidator(listAiThreadsQuerySchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const query = c.req.valid("query");
			const result = await aiService.listAiThreads({
				limit: query.limit,
				organizationId,
				page: query.page,
				userId,
			});
			return c.json(createSuccessResponse(result));
		}
	)
	.get(
		"/threads/:id",
		hasOrgPermission("ai:read"),
		paramValidator(aiThreadIdParamSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const result = await aiService.getAiThread({
				organizationId,
				threadId: id,
				userId,
			});
			return c.json(createSuccessResponse(result));
		}
	)
	.delete(
		"/threads/:id",
		hasOrgPermission("ai:execute"),
		requireNonImpersonatedSession,
		requireTrustedOrigin,
		paramValidator(aiThreadIdParamSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const result = await aiService.deleteAiThread({
				organizationId,
				threadId: id,
				userId,
			});
			return c.json(createSuccessResponse(result));
		}
	)
	.post(
		"/workflows/workspace-brief",
		hasOrgPermission("ai:execute"),
		rateLimiter(60_000, 15, {
			identity: "actor",
			operation: "ai:workflow:workspace-brief",
		}),
		requireNonImpersonatedSession,
		requireTrustedOrigin,
		requireJsonContentType,
		jsonValidator(workspaceBriefRequestSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await aiService.runWorkspaceBrief({
				headers: c.req.raw.headers,
				input,
				operationId: requireWalletOperationId(c.req.header("Idempotency-Key")),
				organizationId,
				requestId: c.get("requestId"),
				userId,
			});
			return c.json(createSuccessResponse(result));
		}
	);
