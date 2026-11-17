import { afterEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

describe("proxy Content-Security-Policy for Turnstile", () => {
	const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

	afterEach(() => {
		if (originalSiteKey === undefined) {
			delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
		} else {
			process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSiteKey;
		}
	});

	test("omits Cloudflare Turnstile origins when site key is unset", () => {
		delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
		const response = proxy(new NextRequest("http://localhost:3000/"));
		const csp = response.headers.get("Content-Security-Policy") ?? "";
		expect(csp).not.toContain("https://challenges.cloudflare.com");
		expect(csp).toContain("frame-src 'self'");
	});

	test("allows Cloudflare Turnstile script, frame, and connect origins when enabled", () => {
		process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
		const response = proxy(new NextRequest("http://localhost:3000/"));
		const csp = response.headers.get("Content-Security-Policy") ?? "";
		expect(csp).toContain("script-src");
		expect(csp).toContain("https://challenges.cloudflare.com");
		expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
		expect(csp).toContain(
			"connect-src 'self' https://challenges.cloudflare.com"
		);
	});
});
