import { createMiddleware } from "hono/factory";
import { env } from "../env";
import type { AppEnv } from "../lib/create-hono-app";
import { AppError, AuthError, ForbiddenError } from "../lib/errors";

const JSON_MEDIA_TYPE = /^application\/(?:[\w.-]+\+)?json$/iu;

export const requireNonImpersonatedSession = createMiddleware<AppEnv>(
	async (c, next) => {
		const session = c.get("session");
		if (!session) {
			throw new AuthError("Authentication required");
		}
		if (session.impersonatedBy) {
			throw new ForbiddenError("Impersonated sessions cannot run this action");
		}
		await next();
	}
);

export const requireTrustedOrigin = createMiddleware<AppEnv>(
	async (c, next) => {
		const origin = c.req.header("Origin");
		if (origin !== undefined) {
			if (!env.CORS_ORIGINS.includes(origin)) {
				throw new ForbiddenError("Untrusted request origin");
			}
		} else if (c.req.header("Sec-Fetch-Site") === "cross-site") {
			throw new ForbiddenError("Cross-site requests are not allowed");
		}
		await next();
	}
);

export const requireJsonContentType = createMiddleware<AppEnv>(
	async (c, next) => {
		const mediaType = c.req.header("Content-Type")?.split(";")[0]?.trim() ?? "";
		if (!JSON_MEDIA_TYPE.test(mediaType)) {
			throw new AppError("This action requires a JSON body", 415);
		}
		await next();
	}
);
