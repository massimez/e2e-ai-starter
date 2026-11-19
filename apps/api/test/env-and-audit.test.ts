import { describe, expect, test } from "bun:test";
import { isBlockedIpAddress } from "@workspace/shared/network";
import { Hono } from "hono";
import { parseApiEnv } from "../src/env";
import {
	type AuditLogRecord,
	extractClientIp,
	isSensitiveReadPath,
	isTrustedProxyIp,
} from "../src/lib/audit";
import { incrementFallbackCounter } from "../src/lib/auth/secondary-storage";
import type { AppEnv } from "../src/lib/create-hono-app";
import { isPgErrorCode } from "../src/lib/errors";
import {
	createAccessAuditMiddleware,
	drainAuditLogs,
} from "../src/middleware/audit";

const VALID_PROD_ENV: Record<string, string> = {
	BETTER_AUTH_SECRET: "production_secret_with_at_least_32_characters_total",
	BETTER_AUTH_URL: "https://api.example.com",
	CORS_ORIGIN: "https://app.example.com, https://admin.example.com",
	DATABASE_URL: "postgresql://user:pass@db.internal:5432/app",
	NODE_ENV: "production",
	REDIS_URL: "redis://redis.internal:6379/1",
	S3_ACCESS_KEY_ID: "prod-access-key",
	S3_SECRET_ACCESS_KEY: "prod-secret-key",
	TRUSTED_PROXY_CIDRS: "10.0.0.0/8, 172.16.0.1",
};

describe("API environment validation", () => {
	test("parses development defaults cleanly", () => {
		const parsed = parseApiEnv({ NODE_ENV: "development" });
		expect(parsed.PORT).toBe(3001);
		expect(parsed.CORS_ORIGINS).toEqual(["http://localhost:3000"]);
		expect(parsed.TRUSTED_PROXY_CIDRS_LIST).toEqual([]);
	});

	test("normalizes blank .env.example AI provider key placeholders to undefined", () => {
		const parsed = parseApiEnv({
			ANTHROPIC_API_KEY: "",
			GOOGLE_API_KEY: "   ",
			GOOGLE_GENERATIVE_AI_API_KEY: "",
			NODE_ENV: "development",
			OPENAI_API_KEY: "",
			OPENROUTER_API_KEY: "  sk-or-test  ",
		});
		expect(parsed.GOOGLE_GENERATIVE_AI_API_KEY).toBeUndefined();
		expect(parsed.GOOGLE_API_KEY).toBeUndefined();
		expect(parsed.OPENAI_API_KEY).toBeUndefined();
		expect(parsed.ANTHROPIC_API_KEY).toBeUndefined();
		expect(parsed.OPENROUTER_API_KEY).toBe("sk-or-test");
	});

	test("rejects partial Google OAuth configuration", () => {
		expect(() =>
			parseApiEnv({
				GOOGLE_CLIENT_ID: "only-client-id",
				NODE_ENV: "development",
			})
		).toThrow("Invalid API environment variables");
	});

	test("rejects production startup with default secret or missing S3/DB/Redis", () => {
		expect(() =>
			parseApiEnv({
				...VALID_PROD_ENV,
				BETTER_AUTH_SECRET:
					"default_development_secret_key_32_characters_minimum",
			})
		).toThrow("Invalid API environment variables");

		expect(() =>
			parseApiEnv({
				...VALID_PROD_ENV,
				S3_ACCESS_KEY_ID: "",
			})
		).toThrow("Invalid API environment variables");
	});

	test("splits CORS origins and trusted proxy CIDRs in production", () => {
		const parsed = parseApiEnv(VALID_PROD_ENV);
		expect(parsed.CORS_ORIGINS).toEqual([
			"https://app.example.com",
			"https://admin.example.com",
		]);
		expect(parsed.TRUSTED_PROXY_CIDRS_LIST).toEqual([
			"10.0.0.0/8",
			"172.16.0.1",
		]);
		expect(parsed.TURNSTILE_SECRET_KEY).toBe("");
		expect(parsed.TURNSTILE_ALLOWED_HOSTNAMES_LIST).toEqual([]);
	});

	test("parses Turnstile secret key and allowed hostnames list", () => {
		const parsed = parseApiEnv({
			NODE_ENV: "development",
			TURNSTILE_ALLOWED_HOSTNAMES: "app.example.com, localhost",
			TURNSTILE_SECRET_KEY: "  test-turnstile-secret  ",
		});
		expect(parsed.TURNSTILE_SECRET_KEY).toBe("test-turnstile-secret");
		expect(parsed.TURNSTILE_ALLOWED_HOSTNAMES_LIST).toEqual([
			"app.example.com",
			"localhost",
		]);
	});
});

describe("proxy trust and client IP extraction", () => {
	test("matches exact IPs and IPv4/IPv6 CIDR subnets safely", () => {
		expect(isTrustedProxyIp("10.24.19.8", ["10.0.0.0/8"])).toBe(true);
		expect(isTrustedProxyIp("192.168.1.5", ["10.0.0.0/8"])).toBe(false);
		expect(isTrustedProxyIp("172.16.0.1", ["172.16.0.1"])).toBe(true);
		expect(isTrustedProxyIp("2001:db8:1::1", ["2001:db8::/32"])).toBe(true);
		expect(isTrustedProxyIp(null, ["10.0.0.0/8"])).toBe(false);
	});

	test("blocks private, loopback, metadata, and non-global IPs while allowing public IPs", () => {
		expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
		expect(isBlockedIpAddress("10.0.0.5")).toBe(true);
		expect(isBlockedIpAddress("169.254.169.254")).toBe(true);
		expect(isBlockedIpAddress("::1")).toBe(true);
		expect(isBlockedIpAddress("::ffff:127.0.0.1")).toBe(true);
		expect(isBlockedIpAddress("fd00::1")).toBe(true);
		expect(isBlockedIpAddress("fe80::1")).toBe(true);
		expect(isBlockedIpAddress("2001:db8::1")).toBe(true);
		expect(isBlockedIpAddress("not-an-ip")).toBe(true);

		expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
		expect(isBlockedIpAddress("1.1.1.1")).toBe(false);
		expect(isBlockedIpAddress("2606:4700:4700::1111")).toBe(false);
		expect(isBlockedIpAddress("::ffff:8.8.8.8")).toBe(false);
	});

	test("ignores spoofed forwarding headers when direct peer is not a trusted proxy", async () => {
		let resolvedIp: string | null = null;
		const app = new Hono().get("/ip", (c) => {
			resolvedIp = extractClientIp(c);
			return c.text("ok");
		});

		await app.fetch(
			new Request("http://localhost/ip", {
				headers: {
					"cf-connecting-ip": "1.2.3.4",
					"x-forwarded-for": "5.6.7.8",
				},
			}),
			{ remoteAddress: "::ffff:203.0.113.10" } as never
		);

		expect(resolvedIp).toBe("203.0.113.10");
	});
});

describe("audit path detection and access audit middleware", () => {
	test("flags sensitive read endpoints and ignores benign reads", () => {
		expect(isSensitiveReadPath("/api/storage/files/123")).toBe(true);
		expect(isSensitiveReadPath("/api/auth/admin/list-users")).toBe(true);
		expect(isSensitiveReadPath("/api/health/ready")).toBe(false);
	});

	test("records write mutations and 403 denials while ignoring benign GETs", async () => {
		const recorded: AuditLogRecord[] = [];
		const app = new Hono<AppEnv>()
			.use("*", async (c, next) => {
				c.set("user", { id: "user_1" } as never);
				c.set("session", { activeOrganizationId: "org_1" } as never);
				await next();
			})
			.use(
				"*",
				createAccessAuditMiddleware({
					scope: "api",
					writeAuditLog: (record) => {
						recorded.push(record);
						return Promise.resolve();
					},
				})
			)
			.get("/api/health", (c) => c.json({ ok: true }))
			.get("/api/forbidden", (c) => c.json({ ok: false }, 403))
			.post("/api/storage/12345678-1234-4234-8234-123456789012", (c) =>
				c.json({ ok: true }, 201)
			);

		await app.request("/api/health");
		await drainAuditLogs();
		expect(recorded).toHaveLength(0);

		await app.request("/api/forbidden");
		await app.request("/api/storage/12345678-1234-4234-8234-123456789012", {
			method: "POST",
		});
		await drainAuditLogs();

		expect(recorded).toHaveLength(2);
		expect(recorded[0]?.action).toBe("security.access_denied");
		expect(recorded[1]?.action).toBe("api.storage.create");
		expect(recorded[1]?.entityId).toBe("12345678-1234-4234-8234-123456789012");
		expect(recorded[1]?.organizationId).toBe("org_1");
		expect(recorded[1]?.userId).toBe("user_1");
	});
});

describe("errors and fallback counter", () => {
	test("allows production startup with QUEUE_DRIVER=inline without Redis", () => {
		const parsed = parseApiEnv({
			BETTER_AUTH_SECRET: "production_secret_with_at_least_32_characters_total",
			BETTER_AUTH_URL: "https://api.example.com",
			CORS_ORIGIN: "https://app.example.com",
			DATABASE_URL: "postgresql://user:pass@db.internal:5432/app",
			NODE_ENV: "production",
			QUEUE_DRIVER: "inline",
			S3_ACCESS_KEY_ID: "prod-access-key",
			S3_SECRET_ACCESS_KEY: "prod-secret-key",
		});
		expect(parsed.QUEUE_DRIVER).toBe("inline");
	});

	test("isPgErrorCode matches direct and wrapped Postgres error codes", () => {
		expect(isPgErrorCode({ code: "23505" }, "23505")).toBe(true);
		expect(isPgErrorCode({ cause: { code: "23505" } }, "23505")).toBe(true);
		expect(isPgErrorCode({ cause: { code: "23503" } }, "23505")).toBe(false);
		expect(isPgErrorCode(null, "23505")).toBe(false);
	});

	test("incrementFallbackCounter enforces monotonic counts on Redis outages", () => {
		const key = `test-fallback-${Date.now()}`;
		expect(incrementFallbackCounter(key, 60)).toBe(1);
		expect(incrementFallbackCounter(key, 60)).toBe(2);
		expect(incrementFallbackCounter(key, 60)).toBe(3);
	});
});
