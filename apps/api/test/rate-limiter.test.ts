import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../src/lib/create-hono-app";
import { redis } from "../src/lib/redis/client";
import { checkRateLimit } from "../src/lib/redis/rate-limit";
import {
	rateLimiter,
	resetMemoryRateLimiter,
} from "../src/middleware/rate-limiter";

function createRateLimitedApp(
	maxRequests = 3,
	windowMs = 10_000,
	path = "/ping",
	identity?: "actor" | "ip"
) {
	return new Hono<AppEnv>()
		.use("*", async (c, next) => {
			const testUserId = c.req.header("x-test-user");
			const testOrgId = c.req.header("x-test-org");
			if (testUserId) {
				c.set("user", { id: testUserId } as never);
				c.set("session", { activeOrganizationId: testOrgId ?? null } as never);
			}
			await next();
		})
		.use("*", rateLimiter(windowMs, maxRequests, { identity }))
		.get(path, (c) => c.json({ ok: true }));
}

describe("rate limiter middleware and redis script", () => {
	beforeEach(() => {
		resetMemoryRateLimiter();
	});

	afterEach(() => {
		mock.restore();
	});

	test("checkRateLimit evaluates Redis response when Redis is healthy", async () => {
		const evalSpy = spyOn(redis, "eval").mockResolvedValueOnce([1, 60]);

		const allowed = await checkRateLimit("ip:127.0.0.1", "GET:/ping", 5, 60);
		expect(evalSpy).toHaveBeenCalledTimes(1);
		expect(allowed.success).toBe(true);
		expect(allowed.remaining).toBe(4);

		evalSpy.mockResolvedValueOnce([6, 45]);
		const blocked = await checkRateLimit("ip:127.0.0.1", "GET:/ping", 5, 60);
		expect(blocked.success).toBe(false);
		expect(blocked.remaining).toBe(0);
	});

	test("checkRateLimit throws when Redis returns malformed tuple", async () => {
		spyOn(redis, "eval").mockResolvedValueOnce("unexpected" as never);

		await expect(
			checkRateLimit("ip:127.0.0.1", "GET:/ping", 5, 60)
		).rejects.toThrow("Redis rate limit Lua script returned invalid response");
	});

	test("attaches rate limit headers on fallback when Redis is unavailable", async () => {
		spyOn(redis, "eval").mockRejectedValue(new Error("Redis offline"));

		const app = createRateLimitedApp(5, 60_000, "/headers");
		const res = await app.request("/headers");

		expect(res.status).toBe(200);
		expect(res.headers.get("x-ratelimit-limit")).toBe("5");
		expect(res.headers.get("x-ratelimit-remaining")).toBe("4");
		expect(res.headers.get("x-ratelimit-reset")).toBeDefined();
	});

	test("blocks requests exceeding the configured threshold with 429", async () => {
		spyOn(redis, "eval").mockRejectedValue(new Error("Redis offline"));

		const app = createRateLimitedApp(2, 60_000, "/threshold");

		expect((await app.request("/threshold")).status).toBe(200);
		expect((await app.request("/threshold")).status).toBe(200);

		const res3 = await app.request("/threshold");
		expect(res3.status).toBe(429);
		expect(res3.headers.get("retry-after")).toBeDefined();

		const body = (await res3.json()) as {
			error: { message: string; name: string };
			success: boolean;
		};
		expect(body.success).toBe(false);
		expect(body.error.name).toBe("TooManyRequestsError");
	});

	test("normalizes UUID path segments into one rate limit bucket", async () => {
		spyOn(redis, "eval").mockRejectedValue(new Error("Redis offline"));

		const app = createRateLimitedApp(1, 60_000, "/files/:id");
		const res1 = await app.request(
			"/files/11111111-1111-4111-8111-111111111111"
		);
		const res2 = await app.request(
			"/files/22222222-2222-4222-8222-222222222222"
		);

		expect(res1.status).toBe(200);
		expect(res2.status).toBe(429);
	});

	test("actor identity isolates quotas across authenticated users", async () => {
		spyOn(redis, "eval").mockRejectedValue(new Error("Redis offline"));

		const app = createRateLimitedApp(1, 60_000, "/scoped", "actor");

		const u1Res1 = await app.request("/scoped", {
			headers: { "x-test-org": "org_1", "x-test-user": "user_1" },
		});
		const u2Res1 = await app.request("/scoped", {
			headers: { "x-test-org": "org_1", "x-test-user": "user_2" },
		});
		const u1Res2 = await app.request("/scoped", {
			headers: { "x-test-org": "org_1", "x-test-user": "user_1" },
		});

		expect(u1Res1.status).toBe(200);
		expect(u2Res1.status).toBe(200);
		expect(u1Res2.status).toBe(429);
	});
});
