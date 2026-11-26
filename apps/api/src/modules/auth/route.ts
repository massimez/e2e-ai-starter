import { auth } from "../../lib/auth/index";
import { createRouter } from "../../lib/create-hono-app";
import { extractClientIp } from "../../lib/ip";
import { rateLimiter } from "../../middleware/rate-limiter";

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
