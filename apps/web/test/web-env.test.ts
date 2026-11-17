import { afterEach, describe, expect, test } from "bun:test";
import { getInternalApiUrl, parseServerWebEnv, publicWebEnv } from "../src/env";

describe("@workspace/web environment validation", () => {
	const originalInternal = process.env.INTERNAL_API_URL;
	const originalPublicApi = process.env.NEXT_PUBLIC_API_URL;

	afterEach(() => {
		if (originalInternal === undefined) {
			delete process.env.INTERNAL_API_URL;
		} else {
			process.env.INTERNAL_API_URL = originalInternal;
		}

		if (originalPublicApi === undefined) {
			delete process.env.NEXT_PUBLIC_API_URL;
		} else {
			process.env.NEXT_PUBLIC_API_URL = originalPublicApi;
		}
	});

	test("validates optional web URLs and feature flags", () => {
		const parsed = parseServerWebEnv({});
		expect(parsed.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED).toBe("false");
		expect(parsed.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe("");
		expect(parsed.INTERNAL_API_URL).toBe("");

		const withTurnstile = parseServerWebEnv({
			NEXT_PUBLIC_TURNSTILE_SITE_KEY: "  1x00000000000000000000AA  ",
		});
		expect(withTurnstile.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe(
			"1x00000000000000000000AA"
		);

		expect(() =>
			parseServerWebEnv({
				INTERNAL_API_URL: "ftp://invalid.example.com",
			})
		).toThrow();
	});

	test("getInternalApiUrl prioritizes INTERNAL_API_URL then NEXT_PUBLIC_API_URL then localhost", () => {
		process.env.INTERNAL_API_URL = "http://api:3001";
		process.env.NEXT_PUBLIC_API_URL = "https://public.example.com";
		expect(getInternalApiUrl()).toBe("http://api:3001");

		delete process.env.INTERNAL_API_URL;
		expect(getInternalApiUrl()).toBe("https://public.example.com");

		delete process.env.NEXT_PUBLIC_API_URL;
		expect(getInternalApiUrl()).toBe("http://localhost:3001");
	});

	test("publicWebEnv only exposes public client flags and URLs", () => {
		expect(Object.keys(publicWebEnv).sort()).toEqual([
			"apiUrl",
			"appUrl",
			"googleAuthEnabled",
			"turnstileSiteKey",
			"vapidPublicKey",
		]);
	});
});
