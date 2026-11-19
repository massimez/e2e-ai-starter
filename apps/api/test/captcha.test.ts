import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { emailOTP } from "better-auth/plugins";
import {
	CAPTCHA_PROTECTED_ENDPOINTS,
	createAuthCaptchaPlugin,
} from "../src/lib/auth/captcha";

interface SiteVerifyPayload {
	remoteip?: string;
	response?: string;
	secret?: string;
}

describe("auth Turnstile captcha protection", () => {
	let mockServer: ReturnType<typeof Bun.serve> | null = null;
	let mockSiteVerifyUrl = "";
	let lastVerifyPayload: SiteVerifyPayload | null = null;

	beforeAll(() => {
		mockServer = Bun.serve({
			port: 0,
			async fetch(request) {
				const body = (await request.json()) as SiteVerifyPayload;
				lastVerifyPayload = body;

				if (body.response === "valid-token") {
					return Response.json({
						hostname: "localhost",
						success: true,
					});
				}

				return Response.json({
					"error-codes": ["invalid-input-response"],
					success: false,
				});
			},
		});
		mockSiteVerifyUrl = `http://127.0.0.1:${mockServer.port}/siteverify`;
	});

	afterAll(() => {
		mockServer?.stop(true);
	});

	function createTestAuth(secretKey: string) {
		const memoryDb: Record<string, Record<string, unknown>[]> = {
			account: [],
			session: [],
			user: [],
			verification: [],
		};

		const captchaPlugin = createAuthCaptchaPlugin({
			allowedHostnames: ["localhost"],
			secretKey,
			siteVerifyURLOverride: mockSiteVerifyUrl,
		});

		return betterAuth({
			advanced: {
				ipAddress: {
					ipAddressHeaders: ["x-resolved-client-ip"],
				},
			},
			baseURL: "http://localhost:3001",
			database: memoryAdapter(memoryDb),
			emailAndPassword: {
				enabled: true,
				requireEmailVerification: false,
			},
			logger: {
				disabled: true,
			},
			plugins: [
				emailOTP({
					async sendVerificationOTP() {
						// no-op in tests
					},
				}),
				...(captchaPlugin ? [captchaPlugin] : []),
			],
			secret: "test-secret-with-at-least-thirty-two-characters-1234",
		});
	}

	test("returns null when TURNSTILE_SECRET_KEY is empty", () => {
		expect(createAuthCaptchaPlugin({ secretKey: "" })).toBeNull();
		expect(createAuthCaptchaPlugin({ secretKey: "   " })).toBeNull();
	});

	test("allows sign-up without captcha header when disabled", async () => {
		const testAuth = createTestAuth("");
		const response = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/sign-up/email", {
				body: JSON.stringify({
					email: "open@example.com",
					name: "Open User",
					password: "password123",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			})
		);
		expect(response.status).toBe(200);
	});

	test("rejects protected endpoints with missing or invalid captcha tokens", async () => {
		const testAuth = createTestAuth("test-secret-key");

		await Promise.all(
			CAPTCHA_PROTECTED_ENDPOINTS.map(async (endpoint) => {
				const missingResponse = await testAuth.handler(
					new Request(`http://localhost:3001/api/auth${endpoint}`, {
						body: JSON.stringify({ email: "bot@example.com" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					})
				);
				expect(missingResponse.status).toBe(400);
				const missingJson = (await missingResponse.json()) as {
					code?: string;
				};
				expect(missingJson.code).toBe("MISSING_RESPONSE");

				const invalidResponse = await testAuth.handler(
					new Request(`http://localhost:3001/api/auth${endpoint}`, {
						body: JSON.stringify({ email: "bot@example.com" }),
						headers: {
							"Content-Type": "application/json",
							"x-captcha-response": "bad-token",
						},
						method: "POST",
					})
				);
				expect(invalidResponse.status).toBe(403);
				const invalidJson = (await invalidResponse.json()) as {
					code?: string;
				};
				expect(invalidJson.code).toBe("VERIFICATION_FAILED");
			})
		);
	});

	test("accepts valid captcha token, forwards resolved IP, and allows unprotected endpoints", async () => {
		const testAuth = createTestAuth("test-secret-key");
		lastVerifyPayload = null;

		const signUpResponse = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/sign-up/email", {
				body: JSON.stringify({
					email: "human@example.com",
					name: "Human User",
					password: "password123",
				}),
				headers: {
					"Content-Type": "application/json",
					"x-captcha-response": "valid-token",
					"x-resolved-client-ip": "203.0.113.42",
				},
				method: "POST",
			})
		);
		expect(signUpResponse.status).toBe(200);
		expect(lastVerifyPayload as SiteVerifyPayload | null).toEqual({
			remoteip: "203.0.113.42",
			response: "valid-token",
			secret: "test-secret-key",
		});

		const healthResponse = await testAuth.handler(
			new Request("http://localhost:3001/api/auth/ok", {
				method: "GET",
			})
		);
		expect(healthResponse.status).toBe(200);
	});
});
