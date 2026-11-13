import { createMiddleware } from "hono/factory";
import { auth, type Session, type User } from "../lib/auth/index";
import { type AppEnv, createErrorResponse } from "../lib/create-hono-app";

export function isActiveUserBan(
	user:
		| { banned?: boolean | null; banExpires?: Date | string | null }
		| null
		| undefined
) {
	if (!user?.banned) {
		return false;
	}
	if (!user.banExpires) {
		return true;
	}
	const banExpiresAt = new Date(user.banExpires).getTime();
	return Number.isFinite(banExpiresAt) && banExpiresAt > Date.now();
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
	// Idempotent: skip session lookup if already resolved
	if (c.get("session") && c.get("user")) {
		await next();
		return;
	}

	const session = await auth.api.getSession({
		headers: c.req.raw.headers,
		query: { disableCookieCache: true },
	});

	if (!session) {
		c.set("session", null);
		c.set("user", null);
		return c.json(
			createErrorResponse("Unauthorized", "Authentication required"),
			401
		);
	}

	if (isActiveUserBan(session.user)) {
		c.set("session", null);
		c.set("user", null);
		return c.json(
			createErrorResponse("UserBanned", "User account is banned"),
			423
		);
	}

	c.set("session", session.session as Session["session"]);
	c.set("user", session.user as User);
	await next();
});
