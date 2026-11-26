import { isPlatformAdminRole } from "@workspace/shared/permissions";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../lib/create-hono-app";
import { AuthError, ForbiddenError } from "../lib/errors";

interface PlatformUser {
	id?: string | null;
	role?: string | null;
}

interface PlatformSession {
	impersonatedBy?: string | null;
}

/**
 * Enforces **Platform Backoffice** authorization (`user.role === "admin"` from Better Auth's
 * `admin()` plugin) and explicitly blocks impersonated sessions.
 *
 * Intentionally separate from organization/tenant roles (`member.role`) so tenant owners
 * and workspace admins can never access `/api/admin/*` backoffice endpoints.
 */
export const platformAdminMiddleware = createMiddleware<AppEnv>(
	async (c, next) => {
		const user = c.get("user") as PlatformUser | null | undefined;
		if (!user?.id) {
			throw new AuthError("Authentication required");
		}
		const session = c.get("session") as PlatformSession | null | undefined;
		if (session?.impersonatedBy) {
			throw new ForbiddenError(
				"Impersonated sessions cannot access platform backoffice endpoints"
			);
		}
		if (!isPlatformAdminRole(user.role)) {
			throw new ForbiddenError("Platform administrator access required");
		}
		await next();
	}
);
