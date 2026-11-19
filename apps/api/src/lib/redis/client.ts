import { logError, logInfo } from "@workspace/shared/logger";
import Redis from "ioredis";
import { env } from "../../env";

export function redactRedisUrl(rawUrl: string): string {
	try {
		const parsed = new URL(rawUrl);
		return `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
	} catch {
		return "[redacted-redis-url]";
	}
}

export const redis = new Redis(env.REDIS_URL, {
	commandTimeout: 2000,
	connectTimeout: 5000,
	enableOfflineQueue: process.env.NODE_ENV !== "test",
	lazyConnect: process.env.NODE_ENV === "test",
	maxRetriesPerRequest: 2,
	reconnectOnError(err) {
		return err.message.includes("READONLY");
	},
	retryStrategy(times) {
		if (process.env.NODE_ENV === "test") {
			return null;
		}
		return Math.min(times * 100, 3000);
	},
});

redis.on("error", (err) => {
	logError("RedisClient", err, { target: redactRedisUrl(env.REDIS_URL) });
});

redis.on("connect", () => {
	logInfo("RedisClient", "Redis connected successfully", {
		target: redactRedisUrl(env.REDIS_URL),
	});
});

export async function closeRedis(): Promise<void> {
	if (redis.status === "end" || redis.status === "wait") {
		redis.disconnect();
		return;
	}
	try {
		await redis.quit();
	} catch {
		redis.disconnect();
	}
}
