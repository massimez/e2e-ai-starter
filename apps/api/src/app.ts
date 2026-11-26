import { createApp } from "./lib/create-hono-app";
import { auditMiddleware } from "./middleware/audit";
import { rateLimiter } from "./middleware/rate-limiter";
import { adminRoutes } from "./modules/admin/route";
import { aiRoutes } from "./modules/ai/route";
import { authRoutes } from "./modules/auth/route";
import { healthRoutes } from "./modules/health/route";
import { notificationRoutes } from "./modules/notification/route";
import { organizationRoutes } from "./modules/organization/route";
import { storageRoutes } from "./modules/storage/route";

const globalIpRateLimiter = rateLimiter(60_000, 300, {
	identity: "ip",
	operation: "api:global",
});

export const app = createApp()
	// Global per-IP flood shield before auth/audit (exempts liveness probes)
	.use("/api/*", async (c, next) => {
		if (c.req.path === "/api/health" || c.req.path === "/api/health/live") {
			await next();
			return;
		}
		return await globalIpRateLimiter(c, next);
	})
	.use("*", auditMiddleware)
	.basePath("/api")
	.route("/health", healthRoutes)
	.route("/auth", authRoutes)
	.route("/ai", aiRoutes)
	.route("/admin", adminRoutes)
	.route("/organizations", organizationRoutes)
	.route("/storage", storageRoutes)
	.route("/notifications", notificationRoutes);

export type AppType = typeof app;
