import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { extractClientIp } from "../lib/audit";
import { type AppEnv, createErrorResponse } from "../lib/create-hono-app";
import { logWarning } from "../lib/logger";
import { checkRateLimit, type RateLimitResult } from "../lib/redis/rate-limit";

interface MemoryStoreEntry {
	count: number;
	resetTime: number;
}

export interface RateLimiterOptions {
	identity?: "actor" | "ip";
	operation?: string;
}

const MAX_MEMORY_STORE_ENTRIES = 10_000;

const UUID_PATH_SEGMENT_REGEX =
	/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/giu;
const OPAQUE_PATH_SEGMENT_REGEX = /\/[A-Za-z0-9_-]{24,}(?=\/|$)/gu;
const INTEGER_PATH_SEGMENT_REGEX = /\/\d+(?=\/|$)/gu;

function normalizeRateLimitPath(path: string): string {
	return path
		.replace(UUID_PATH_SEGMENT_REGEX, "/:id")
		.replace(OPAQUE_PATH_SEGMENT_REGEX, "/:token")
		.replace(INTEGER_PATH_SEGMENT_REGEX, "/:id");
}

const memoryStore = new Map<string, MemoryStoreEntry>();

export function resetMemoryRateLimiter(): void {
	memoryStore.clear();
}

function pruneMemoryStore(now: number): void {
	for (const [key, entry] of memoryStore.entries()) {
		if (entry.resetTime <= now) {
			memoryStore.delete(key);
		}
	}

	if (memoryStore.size >= MAX_MEMORY_STORE_ENTRIES) {
		const excess = memoryStore.size - MAX_MEMORY_STORE_ENTRIES + 1;
		let removed = 0;
		for (const oldestKey of memoryStore.keys()) {
			memoryStore.delete(oldestKey);
			removed += 1;
			if (removed >= excess) {
				break;
			}
		}
	}
}

// Periodic cleanup of expired entries in memory fallback store
const cleanupInterval = setInterval(() => {
	pruneMemoryStore(Date.now());
}, 60_000);

if (typeof cleanupInterval.unref === "function") {
	cleanupInterval.unref();
}

function getMemoryRateLimitResult(
	identifier: string,
	routeKey: string,
	windowMs: number,
	max: number
): RateLimitResult {
	const now = Date.now();
	const key = `${identifier}:${routeKey}`;
	const entry = memoryStore.get(key);

	if (!entry || entry.resetTime <= now) {
		if (memoryStore.size >= MAX_MEMORY_STORE_ENTRIES) {
			pruneMemoryStore(now);
		}
		const resetTime = now + windowMs;
		memoryStore.set(key, { count: 1, resetTime });
		return {
			remaining: Math.max(0, max - 1),
			reset: Math.ceil(resetTime / 1000),
			success: true,
		};
	}

	entry.count += 1;

	return {
		remaining: Math.max(0, max - entry.count),
		reset: Math.ceil(entry.resetTime / 1000),
		success: entry.count <= max,
	};
}

function resolveIdentifier(
	c: Context<AppEnv>,
	identity?: "actor" | "ip"
): string {
	if (identity === "actor") {
		const user = c.get("user");
		if (user?.id) {
			const session = c.get("session");
			return `user:${user.id}:tenant:${session?.activeOrganizationId ?? "personal"}`;
		}
	}

	const ip = extractClientIp(c) ?? "unknown";
	return `ip:${ip}`;
}

export function rateLimiter(
	windowMs = 60_000,
	maxRequests = 100,
	options: RateLimiterOptions = {}
): MiddlewareHandler<AppEnv> {
	const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

	return createMiddleware<AppEnv>(async (c, next) => {
		const identifier = resolveIdentifier(c, options.identity);
		const routeKey =
			options.operation ??
			`${c.req.method}:${normalizeRateLimitPath(c.req.path)}`;

		let result: RateLimitResult;
		try {
			result = await checkRateLimit(
				identifier,
				routeKey,
				maxRequests,
				windowSeconds
			);
		} catch (error) {
			logWarning(
				"RateLimiter",
				"Redis unavailable, falling back to memory rate limiting",
				{ error: error instanceof Error ? error.message : String(error) }
			);
			result = getMemoryRateLimitResult(
				identifier,
				routeKey,
				windowMs,
				maxRequests
			);
		}

		c.header("X-RateLimit-Limit", maxRequests.toString());
		c.header("X-RateLimit-Remaining", result.remaining.toString());
		c.header("X-RateLimit-Reset", result.reset.toString());

		if (!result.success) {
			const retryAfter = Math.max(
				1,
				result.reset - Math.floor(Date.now() / 1000)
			);
			c.header("Retry-After", retryAfter.toString());

			return c.json(
				createErrorResponse(
					"TooManyRequestsError",
					"Too many requests, please try again later",
					[
						{
							code: "RATE_LIMIT_EXCEEDED",
							message: "Rate limit threshold exceeded",
							path: [],
						},
					]
				),
				429
			);
		}

		await next();
	});
}
