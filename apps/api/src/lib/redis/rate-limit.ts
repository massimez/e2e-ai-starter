import { env } from "../../env";
import { redis } from "./client";

export interface RateLimitResult {
	remaining: number;
	reset: number;
	success: boolean;
}

const ATOMIC_RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
local window = tonumber(ARGV[1])
if current == 1 then
	redis.call("EXPIRE", KEYS[1], window)
end
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then
	redis.call("EXPIRE", KEYS[1], window)
	ttl = window
end
return { current, ttl }
`;

export async function checkRateLimit(
	identifier: string,
	route: string,
	limit: number,
	windowSeconds: number
): Promise<RateLimitResult> {
	const key = `${env.REDIS_PREFIX}:rate-limit:${identifier}:${route}`;

	const rawResult = await redis.eval(
		ATOMIC_RATE_LIMIT_SCRIPT,
		1,
		key,
		String(windowSeconds)
	);

	if (!Array.isArray(rawResult) || rawResult.length < 2) {
		throw new Error("Redis rate limit Lua script returned invalid response");
	}

	const count = Number(rawResult[0] ?? 1);
	const rawTtl = Number(rawResult[1] ?? windowSeconds);
	const currentTtl =
		Number.isFinite(rawTtl) && rawTtl >= 0 ? rawTtl : windowSeconds;

	return {
		remaining: Math.max(0, limit - count),
		reset: Math.floor(Date.now() / 1000) + Math.max(1, currentTtl),
		success: count <= limit,
	};
}
