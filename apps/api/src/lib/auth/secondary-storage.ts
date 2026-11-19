import { env } from "../../env";
import { logWarning } from "../logger";
import { redis } from "../redis/client";

const MAX_FALLBACK_COUNTERS = 10_000;
const fallbackCounters = new Map<
	string,
	{ count: number; expiresAt: number }
>();

export function authSecondaryKey(key: string): string {
	return `${env.REDIS_PREFIX}:auth:${key}`;
}

/**
 * Bounded in-memory fallback counter used only if Redis secondary storage fails during
 * rate-limit / OTP attempt increments, avoiding fail-open behavior on Redis outages.
 */
export function incrementFallbackCounter(
	key: string,
	ttlSeconds: number
): number {
	const now = Date.now();
	const effectiveTtlMs = Math.max(1, Math.ceil(ttlSeconds)) * 1000;
	const existing = fallbackCounters.get(key);
	if (existing && existing.expiresAt > now) {
		const nextCount = existing.count + 1;
		fallbackCounters.set(key, {
			count: nextCount,
			expiresAt: existing.expiresAt,
		});
		return nextCount;
	}

	if (fallbackCounters.size >= MAX_FALLBACK_COUNTERS) {
		for (const [entryKey, entry] of fallbackCounters) {
			if (entry.expiresAt <= now) {
				fallbackCounters.delete(entryKey);
			}
		}
		while (fallbackCounters.size >= MAX_FALLBACK_COUNTERS) {
			const oldestKey = fallbackCounters.keys().next().value;
			if (!oldestKey) {
				break;
			}
			fallbackCounters.delete(oldestKey);
		}
	}

	fallbackCounters.set(key, {
		count: 1,
		expiresAt: now + effectiveTtlMs,
	});
	return 1;
}

/**
 * Best-effort invalidation of Better Auth Redis secondary-storage session caches
 * for a user whose organization membership or active organization changed in PostgreSQL.
 */
export async function invalidateUserSessionCache(
	userId: string,
	sessionTokens: readonly string[]
): Promise<void> {
	const keys = [
		authSecondaryKey(`active-sessions-${userId}`),
		...sessionTokens.filter(Boolean).map((token) => authSecondaryKey(token)),
	];
	if (keys.length === 0) {
		return;
	}
	try {
		await redis.del(...keys);
	} catch (error) {
		logWarning(
			"AuthSecondaryStorage:Invalidate",
			"Failed to invalidate cached session keys in Redis",
			{
				error: error instanceof Error ? error.message : String(error),
				userId,
			}
		);
	}
}
