import { createApp } from "./lib/create-hono-app";
import { auditMiddleware } from "./middleware/audit";
import { aiRoutes } from "./modules/ai/route";
import { authRoutes } from "./modules/auth/route";
import { healthRoutes } from "./modules/health/route";
import { notificationRoutes } from "./modules/notification/route";
import { organizationRoutes } from "./modules/organization/route";
import { storageRoutes } from "./modules/storage/route";

export const app = createApp()
	.use("*", auditMiddleware)
	.basePath("/api")
	.route("/health", healthRoutes)
	.route("/auth", authRoutes)
	.route("/ai", aiRoutes)
	.route("/organizations", organizationRoutes)
	.route("/storage", storageRoutes)
	.route("/notifications", notificationRoutes);

export type AppType = typeof app;
