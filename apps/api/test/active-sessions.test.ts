import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Hono } from "hono";
import { auth } from "../src/lib/auth";
import { redis } from "../src/lib/redis/client";
import { authRoutes } from "../src/modules/auth/route";
import * as defaults from "../src/modules/organization/default-organization";

afterEach(() => mock.restore());

test("session lists are non-cacheable and rate limited", async () => {
	const app = new Hono().route("/api/auth", authRoutes);
	spyOn(redis, "eval")
		.mockResolvedValueOnce([20, 45])
		.mockResolvedValueOnce([21, 45]);
	const request = () => app.request("/api/auth/list-sessions");
	const allowed = await request();
	expect(allowed.status).toBe(401);
	expect(allowed.headers.get("Cache-Control")).toBe("no-store");
	const blocked = await request();
	expect(blocked.status).toBe(429);
	expect(blocked.headers.get("X-RateLimit-Limit")).toBe("20");
	expect(blocked.headers.get("Retry-After")).toBeTruthy();
	expect(blocked.headers.get("Cache-Control")).toBe("no-store");
});

test("stores device details and keeps the current session after individual and bulk sign-out", async () => {
	spyOn(defaults, "resolveSessionOrganizationOnConnect").mockResolvedValue(
		null
	);
	const testAuth = betterAuth({
		baseURL: "http://localhost:3001",
		secret: "local-session-test-secret-with-thirty-two-characters",
		database: memoryAdapter({
			user: [],
			account: [],
			session: [],
			verification: [],
		}),
		advanced: auth.options.advanced,
		session: auth.options.session,
		databaseHooks: { session: auth.options.databaseHooks.session },
		emailAndPassword: { enabled: true },
	});
	const body = {
		email: "sessions@example.com",
		name: "Session test",
		password: "session-test-passphrase",
	};
	const headers = new Headers({
		"x-resolved-client-ip": "::1",
		"user-agent": "Test desktop",
	});
	const current = await testAuth.api.signUpEmail({
		body,
		headers,
		asResponse: true,
	});
	expect(current.status).toBe(200);
	const cookie = current.headers.getSetCookie()[0]?.split(";")[0];
	if (!cookie) {
		throw new Error("Expected a session cookie");
	}
	const currentHeaders = new Headers({ cookie });
	const other = await testAuth.api.signInEmail({
		body,
		headers: new Headers({
			"x-resolved-client-ip": "8.8.8.8",
			"user-agent": "Test phone",
		}),
	});
	const third = await testAuth.api.signInEmail({ body, headers });
	const list = () => testAuth.api.listSessions({ headers: currentHeaders });
	const sessions = await list();
	expect(sessions).toHaveLength(3);
	expect(sessions.find((s) => s.token === other.token)).toMatchObject({
		userAgent: "Test phone",
		ipAddress: "8.8.8.8",
	});
	await testAuth.api.revokeSession({
		headers: currentHeaders,
		body: { token: other.token },
	});
	expect((await list()).map((s) => s.token)).toContain(third.token);
	expect(await list()).toHaveLength(2);
	await testAuth.api.revokeOtherSessions({ headers: currentHeaders });
	const remaining = await list();
	expect(remaining).toHaveLength(1);
	expect(remaining[0]).toMatchObject({
		userAgent: "Test desktop",
	});
	expect(
		await testAuth.api.getSession({ headers: currentHeaders })
	).toBeTruthy();
});
