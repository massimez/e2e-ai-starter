import { createRouter } from "../../lib/create-hono-app";
import { authMiddleware } from "../../middleware/auth";
import { platformAdminMiddleware } from "../../middleware/platform-admin";
import { rateLimiter } from "../../middleware/rate-limiter";
import { adminAuditRoutes } from "./audit/route";
import { adminOrganizationsRoutes } from "./organizations/route";
import { adminOverviewRoutes } from "./overview/route";
import { adminSystemRoutes } from "./system/route";
import { adminUsersRoutes } from "./users/route";

/**
 * Platform Backoffice router mounted at `/api/admin`.
 * Enforces authentication, `platformAdminMiddleware` (`user.role === "admin"`),
 * per-user rate limiting, and `Cache-Control: no-store` once at the boundary.
 */
export const adminRoutes = createRouter()
	.use(
		"*",
		authMiddleware,
		platformAdminMiddleware,
		rateLimiter(60_000, 60, { identity: "user" }),
		async (c, next) => {
			await next();
			c.header("Cache-Control", "no-store");
		}
	)
	.route("/overview", adminOverviewRoutes)
	.route("/users", adminUsersRoutes)
	.route("/organizations", adminOrganizationsRoutes)
	.route("/audit", adminAuditRoutes)
	.route("/system", adminSystemRoutes);
