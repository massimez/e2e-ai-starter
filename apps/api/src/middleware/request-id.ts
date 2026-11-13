import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../lib/create-hono-app";

const VALID_REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/u;

export function requestIdMiddleware(): MiddlewareHandler<AppEnv> {
	return createMiddleware<AppEnv>(async (c, next) => {
		const incomingId = c.req.header("x-request-id")?.trim();
		const requestId =
			incomingId && VALID_REQUEST_ID_REGEX.test(incomingId)
				? incomingId
				: crypto.randomUUID();

		c.set("requestId", requestId);
		c.header("x-request-id", requestId);

		await next();
	});
}
