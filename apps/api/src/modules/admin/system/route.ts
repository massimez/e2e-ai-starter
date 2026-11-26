import {
	createRouter,
	createSuccessResponse,
} from "../../../lib/create-hono-app";
import { rateLimiter } from "../../../middleware/rate-limiter";
import { adminSystemService } from "./service";

/** System health and queue sub-routes mounted under `/api/admin/system`. */
export const adminSystemRoutes = createRouter()
	.get("/", async (c) => {
		const status = await adminSystemService.getSystemStatus();
		return c.json(createSuccessResponse(status));
	})
	.post(
		"/retention/run",
		rateLimiter(60_000, 3, {
			identity: "user",
			operation: "admin:system:retention-run",
		}),
		async (c) => {
			const result = await adminSystemService.triggerRetentionSweep();
			c.set("auditMeta", {
				action: "admin.system.retention_trigger",
				details: { jobId: result.jobId, queue: result.queue },
				entityId: result.jobId,
				entityType: "retention-queue",
				organizationId: null,
			});
			return c.json(createSuccessResponse(result), 202);
		}
	);
