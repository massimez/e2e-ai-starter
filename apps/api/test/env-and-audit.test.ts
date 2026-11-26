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
	DATABASE_SSL: "true",
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

	test("rejects insecure HTTP origins, non-SSL remote DB, and short/default ENCRYPTION_SECRET in production", () => {
		expect(() =>
			parseApiEnv({
				...VALID_PROD_ENV,
				BETTER_AUTH_URL: "http://api.example.com",
			})
		).toThrow("Invalid API environment variables");

		expect(() =>
			parseApiEnv({
				...VALID_PROD_ENV,
				CORS_ORIGIN: "http://app.example.com",
			})
		).toThrow("Invalid API environment variables");

		expect(() =>
			parseApiEnv({
				...VALID_PROD_ENV,
				DATABASE_SSL: "false",
			})
		).toThrow("Invalid API environment variables");

		expect(() =>
			parseApiEnv({
				...VALID_PROD_ENV,
				ENCRYPTION_SECRET: "short",
			})
		).toThrow("Invalid API environment variables");

		// sslmode=require in DATABASE_URL satisfies TLS requirement
		const withSslMode = parseApiEnv({
			...VALID_PROD_ENV,
			DATABASE_SSL: "false",
			DATABASE_URL:
				"postgresql://user:pass@db.internal:5432/app?sslmode=require",
		});
		expect(withSslMode.ENCRYPTION_SECRET).toBe(
			"production_secret_with_at_least_32_characters_total"
		);
		expect(withSslMode.SESSION_EXPIRES_IN_SECONDS).toBe(604_800);
		expect(withSslMode.SESSION_UPDATE_AGE_SECONDS).toBe(86_400);
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
		const app = new Hono<AppEnv>().get("/ip", (c) => {
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

		expect(resolvedIp as string | null).toBe("203.0.113.10");
	});
});

describe("audit path detection and access audit middleware", () => {
	test("flags sensitive read endpoints and ignores benign reads", () => {
		expect(isSensitiveReadPath("/api/storage/files/123")).toBe(true);
		expect(isSensitiveReadPath("/api/auth/admin/list-users")).toBe(true);
		expect(isSensitiveReadPath("/api/admin/audit/export")).toBe(true);
		expect(isSensitiveReadPath("/api/auth/organization/list")).toBe(false);
		expect(isSensitiveReadPath("/api/admin/audit")).toBe(false);
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

	test("records session.impersonatedBy in audit log details when present", async () => {
		const recorded: AuditLogRecord[] = [];
		const app = new Hono<AppEnv>()
			.use("*", async (c, next) => {
				c.set("user", { id: "target_user" } as never);
				c.set("session", {
					activeOrganizationId: "org_1",
					impersonatedBy: "admin_support_7",
				} as never);
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
			.post("/api/organizations/current", (c) => c.json({ ok: true }));

		await app.request("/api/organizations/current", { method: "POST" });
		await drainAuditLogs();

		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.details?.impersonatedBy).toBe("admin_support_7");
	});

	test("resolves authenticated actor and active organization on /api/auth/* routes without authMiddleware", async () => {
		const recorded: AuditLogRecord[] = [];
		let signedOut = false;
		const app = new Hono<AppEnv>()
			.use(
				"*",
				createAccessAuditMiddleware({
					resolveSession: () => {
						if (signedOut) {
							return Promise.resolve(null);
						}
						return Promise.resolve({
							session: {
								activeOrganizationId: "org_tenant_1",
								userId: "usr_tenant_1",
							},
							user: { id: "usr_tenant_1" },
						});
					},
					scope: "app",
					writeAuditLog: (record) => {
						recorded.push(record);
						return Promise.resolve();
					},
				})
			)
			.post("/api/auth/organization/invite-member", (c) => c.json({ ok: true }))
			.post("/api/auth/sign-out", (c) => {
				signedOut = true;
				return c.json({ ok: true });
			});

		await app.request("/api/auth/organization/invite-member", {
			headers: { cookie: "better-auth.session_token=valid" },
			method: "POST",
		});
		await app.request("/api/auth/sign-out", {
			headers: { cookie: "better-auth.session_token=valid" },
			method: "POST",
		});
		await drainAuditLogs();

		expect(recorded).toHaveLength(2);
		expect(recorded[0]?.userId).toBe("usr_tenant_1");
		expect(recorded[0]?.organizationId).toBe("org_tenant_1");
		expect(recorded[1]?.userId).toBe("usr_tenant_1");
		expect(recorded[1]?.organizationId).toBe("org_tenant_1");
	});

	test("pre-captures stop-impersonating actor, skips double lookup on 401, and avoids org pollution on /api/admin/*", async () => {
		const recorded: AuditLogRecord[] = [];
		let resolverCalls = 0;
		let impersonationStopped = false;

		const app = new Hono<AppEnv>()
			.use(
				"*",
				createAccessAuditMiddleware({
					resolveSession: () => {
						resolverCalls += 1;
						if (impersonationStopped) {
							return Promise.resolve(null);
						}
						return Promise.resolve({
							session: {
								activeOrganizationId: "org_customer",
								impersonatedBy: "usr_superadmin",
								userId: "usr_customer",
							},
							user: { id: "usr_customer" },
						});
					},
					scope: "app",
					writeAuditLog: (record) => {
						recorded.push(record);
						return Promise.resolve();
					},
				})
			)
			.post("/api/auth/admin/stop-impersonating", (c) => {
				impersonationStopped = true;
				c.set("auditMeta", {
					action: "admin.user.impersonate_stop",
					entityType: "user",
					organizationId: null,
				});
				return c.json({ ok: true });
			})
			.get("/api/protected-401", (c) => {
				// Simulate authMiddleware rejecting with 401 after setting session/user to null
				c.set("session", null);
				c.set("user", null);
				return c.json({ error: "Unauthorized" }, 401);
			})
			.post("/api/admin/users/usr_target/ban", (c) => {
				c.set("user", { id: "usr_superadmin" } as never);
				c.set("session", {
					activeOrganizationId: "org_operator_personal",
					userId: "usr_superadmin",
				} as never);
				c.set("auditMeta", {
					action: "admin.user.ban",
					details: { reason: "Abuse" },
					entityId: "usr_target",
					entityType: "user",
					organizationId: null,
				});
				return c.json({ ok: true });
			});

		await app.request("/api/auth/admin/stop-impersonating", {
			headers: { cookie: "better-auth.session_token=imp" },
			method: "POST",
		});
		expect(resolverCalls).toBe(1);

		await app.request("/api/protected-401", {
			headers: { cookie: "better-auth.session_token=stale" },
			method: "GET",
		});
		await app.request("/api/admin/users/usr_target/ban", { method: "POST" });
		await drainAuditLogs();

		// 401 after authMiddleware must NOT call resolveSession a second time
		expect(resolverCalls).toBe(1);
		expect(recorded).toHaveLength(3);

		// stop-impersonating keeps pre-captured actor & impersonatedBy
		expect(recorded[0]?.action).toBe("admin.user.impersonate_stop");
		expect(recorded[0]?.userId).toBe("usr_customer");
		expect(recorded[0]?.details?.impersonatedBy).toBe("usr_superadmin");
		expect(recorded[0]?.organizationId).toBeNull();

		// /api/admin/* uses explicit auditMeta and does NOT inherit operator's activeOrganizationId
		expect(recorded[2]?.action).toBe("admin.user.ban");
		expect(recorded[2]?.entityId).toBe("usr_target");
		expect(recorded[2]?.organizationId).toBeNull();
		expect(recorded[2]?.details?.reason).toBe("Abuse");
	});

	test("enforces maxPendingWrites backpressure cap when audit writes stall", async () => {
		let releaseFirstWrite: (() => void) | undefined;
		const recorded: AuditLogRecord[] = [];
		const app = new Hono<AppEnv>()
			.use(
				"*",
				createAccessAuditMiddleware({
					maxPendingWrites: 1,
					scope: "api",
					writeAuditLog: async (record) => {
						if (!releaseFirstWrite) {
							await new Promise<void>((resolve) => {
								releaseFirstWrite = resolve;
							});
						}
						recorded.push(record);
					},
				})
			)
			.post("/api/items", (c) => c.json({ ok: true }));

		// First write stays in flight; second write hits maxPendingWrites cap and is dropped
		await app.request("/api/items", { method: "POST" });
		await app.request("/api/items", { method: "POST" });
		releaseFirstWrite?.();
		await drainAuditLogs();

		expect(recorded).toHaveLength(1);
	});
});

describe("errors and fallback counter", () => {
	test("allows production startup with QUEUE_DRIVER=inline without Redis", () => {
		const parsed = parseApiEnv({
			BETTER_AUTH_SECRET: "production_secret_with_at_least_32_characters_total",
			BETTER_AUTH_URL: "https://api.example.com",
			CORS_ORIGIN: "https://app.example.com",
			DATABASE_SSL: "true",
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
