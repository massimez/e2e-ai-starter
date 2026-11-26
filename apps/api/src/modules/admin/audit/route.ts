import {
	createRouter,
	createSuccessResponse,
	queryValidator,
} from "../../../lib/create-hono-app";
import { rateLimiter } from "../../../middleware/rate-limiter";
import { exportAuditLogsQuerySchema, listAuditLogsQuerySchema } from "./schema";
import { auditService } from "./service";

/** Audit log sub-routes mounted under `/api/admin/audit`. */
export const adminAuditRoutes = createRouter()
	.get("/", queryValidator(listAuditLogsQuerySchema), async (c) => {
		const result = await auditService.listAuditLogs(c.req.valid("query"));
		return c.json(createSuccessResponse(result));
	})
	.get(
		"/export",
		rateLimiter(60_000, 10, {
			identity: "user",
			operation: "admin:audit:export",
		}),
		queryValidator(exportAuditLogsQuerySchema),
		async (c) => {
			const exported = await auditService.exportAuditLogs(c.req.valid("query"));
			return c.body(exported.payload, 200, {
				"Cache-Control": "no-store",
				"Content-Disposition": `attachment; filename="${exported.filename}"`,
				"Content-Type": exported.contentType,
				"X-Content-Type-Options": "nosniff",
			});
		}
	);
