import { auth } from "../../lib/auth/index";
import { createErrorResponse, createRouter } from "../../lib/create-hono-app";
import { extractClientIp } from "../../lib/ip";
import { authMiddleware } from "../../middleware/auth";
import { platformAdminMiddleware } from "../../middleware/platform-admin";
import { rateLimiter } from "../../middleware/rate-limiter";

const ALLOWED_BETTER_AUTH_ADMIN_PATHS = new Set([
	"/impersonate-user",
	"/stop-impersonating",
]);

function extractAuthAdminSubpath(path: string): string | null {
	const marker = "/admin/";
	const idx = path.lastIndexOf(marker);
	if (idx === -1) {
		return null;
	}
	return path.slice(idx + "/admin".length);
}

async function readImpersonationTargetUserId(
	req: Request
): Promise<string | null> {
	try {
		const payload = (await req.clone().json()) as { userId?: unknown };
		return typeof payload.userId === "string" &&
			payload.userId.trim().length > 0
			? payload.userId.trim()
			: null;
	} catch {
		return null;
	}
}

export const authRoutes = createRouter()
	.use(
		"/list-sessions",
		async (c, next) => {
			await next();
			c.header("Cache-Control", "no-store");
		},
		rateLimiter(60_000, 20)
	)
	// Stricter rate limits for login/signup attempts (10 per minute)
	.use("/sign-in/*", rateLimiter(60_000, 10))
	.use("/sign-up/*", rateLimiter(60_000, 10))
	// Stricter rate limits for OTP and password operations (5 per minute)
	.use("/email-otp/*", rateLimiter(60_000, 5))
	.use("/forget-password/*", rateLimiter(60_000, 5))
	.use("/request-password-reset", rateLimiter(60_000, 5))
	.use("/request-password-reset/*", rateLimiter(60_000, 5))
	.use("/reset-password/*", rateLimiter(60_000, 5))
	.use("/send-verification-email", rateLimiter(60_000, 5))
	.use("/change-password", rateLimiter(60_000, 5))
	.use(
		"/two-factor/*",
		async (c, next) => {
			await next();
			c.header("Cache-Control", "no-store");
		},
		rateLimiter(60_000, 10)
	)
	// Lock down Better Auth's built-in admin plugin routes: only impersonation lifecycle
	// endpoints remain active here; all user/role/ban mutations must go through `/api/admin/*`.
	.use("/admin/*", async (c, next) => {
		const subPath = extractAuthAdminSubpath(c.req.path);
		if (
			c.req.method.toUpperCase() !== "POST" ||
			!subPath ||
			!ALLOWED_BETTER_AUTH_ADMIN_PATHS.has(subPath)
		) {
			return c.json(
				createErrorResponse(
					"ForbiddenError",
					"Direct Better Auth admin endpoints are disabled. Use /api/admin/* instead."
				),
				403
			);
		}
		await next();
		c.header("Cache-Control", "no-store");
	})
	.use(
		"/admin/impersonate-user",
		authMiddleware,
		platformAdminMiddleware,
		rateLimiter(60_000, 10, {
			identity: "user",
			operation: "auth:admin:impersonate-user",
		}),
		async (c, next) => {
			const targetUserId = await readImpersonationTargetUserId(c.req.raw);
			c.set("auditMeta", {
				action: "admin.user.impersonate_start",
				details: targetUserId ? { targetUserId } : undefined,
				entityId: targetUserId,
				entityType: "user",
				organizationId: null,
			});
			await next();
		}
	)
	.use(
		"/admin/stop-impersonating",
		rateLimiter(60_000, 20, {
			identity: "ip",
			operation: "auth:admin:stop-impersonating",
		}),
		async (c, next) => {
			c.set("auditMeta", {
				action: "admin.user.impersonate_stop",
				entityType: "user",
				organizationId: null,
			});
			await next();
		}
	)
	// Organization management / invitation abuse protection (20 per minute)
	.use("/organization/*", rateLimiter(60_000, 20))
	.all("/*", (c) => {
		const clientIp = extractClientIp(c);
		const headers = new Headers(c.req.raw.headers);
		headers.delete("x-resolved-client-ip");
		if (clientIp) {
			headers.set("x-resolved-client-ip", clientIp);
		}
		return auth.handler(new Request(c.req.raw, { headers }));
	});
