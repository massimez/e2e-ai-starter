import { defaultLogger, type Logger } from "@workspace/shared/logger";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../lib/create-hono-app";

export interface HttpLoggerOptions {
	logger?: Logger;
	skipPaths?: readonly string[];
}

function buildRequestTarget(path: string, rawUrl: string): string {
	const queryIndex = rawUrl.indexOf("?");
	if (queryIndex === -1) {
		return path;
	}
	const hashIndex = rawUrl.indexOf("#", queryIndex);
	const rawQuery =
		hashIndex === -1
			? rawUrl.slice(queryIndex)
			: rawUrl.slice(queryIndex, hashIndex);
	return `${path}${rawQuery}`;
}

/**
 * Emits one structured HTTP access log on request completion with method,
 * sanitized path/query, status code, duration, request ID, and tenant/actor IDs.
 */
export function httpLoggerMiddleware(
	options: HttpLoggerOptions = {}
): MiddlewareHandler<AppEnv> {
	const targetLogger = options.logger ?? defaultLogger;
	const skipped = options.skipPaths ? new Set(options.skipPaths) : null;

	return createMiddleware<AppEnv>(async (c, next) => {
		if (skipped?.has(c.req.path)) {
			await next();
			return;
		}

		const startedAt = performance.now();
		let threw = false;

		try {
			await next();
		} catch (error) {
			threw = true;
			throw error;
		} finally {
			const durationMs = performance.now() - startedAt;
			const status = threw ? 500 : c.res.status;
			const user = c.get("user");
			const session = c.get("session");

			targetLogger.logHttp({
				durationMs,
				method: c.req.method,
				organizationId: session?.activeOrganizationId ?? undefined,
				path: buildRequestTarget(c.req.path, c.req.url),
				requestId: c.get("requestId"),
				status,
				userId: user?.id,
			});
		}
	});
}
