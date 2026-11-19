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
import { tenantBoundaryMiddleware } from "../../middleware/tenant-boundary";
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
	.post(
		"/chat",
		hasOrgPermission("ai:execute"),
		rateLimiter(60_000, 30, { identity: "actor", operation: "ai:chat" }),
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
		jsonValidator(workspaceBriefRequestSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await aiService.runWorkspaceBrief({
				headers: c.req.raw.headers,
				input,
				organizationId,
				requestId: c.get("requestId"),
				userId,
			});
			return c.json(createSuccessResponse(result));
		}
	);
