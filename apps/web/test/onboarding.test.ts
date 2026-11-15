import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { resolveSafeOnboardingRedirect } from "../src/app/onboarding/_components/onboarding-redirect";
import { proxy, config as proxyConfig } from "../src/proxy";

describe("onboarding redirect safety", () => {
	test("allows internal /dashboard routes and rejects external or protocol-relative URLs", () => {
		expect(resolveSafeOnboardingRedirect(undefined)).toBe("/dashboard");
		expect(resolveSafeOnboardingRedirect(null)).toBe("/dashboard");
		expect(resolveSafeOnboardingRedirect("")).toBe("/dashboard");
		expect(resolveSafeOnboardingRedirect("/dashboard")).toBe("/dashboard");
		expect(resolveSafeOnboardingRedirect("/dashboard/settings/members")).toBe(
			"/dashboard/settings/members"
		);
		expect(resolveSafeOnboardingRedirect(["/dashboard/settings"])).toBe(
			"/dashboard/settings"
		);
		expect(
			resolveSafeOnboardingRedirect("https://evil.example/dashboard")
		).toBe("/dashboard");
		expect(resolveSafeOnboardingRedirect("//evil.example")).toBe("/dashboard");
		expect(resolveSafeOnboardingRedirect("/dashboard\\evil")).toBe(
			"/dashboard"
		);
		expect(resolveSafeOnboardingRedirect("/onboarding")).toBe("/dashboard");
	});
});

describe("proxy onboarding gate protection and CSP", () => {
	test("protects both /dashboard/:path* and /onboarding and sets CSP header", () => {
		expect(proxyConfig.matcher).toEqual([
			"/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
		]);

		const unauthOnboardingResponse = proxy(
			new NextRequest("http://localhost:3000/onboarding")
		);
		expect(unauthOnboardingResponse.status).toBe(307);
		expect(unauthOnboardingResponse.headers.get("location")).toBe(
			"http://localhost:3000/?auth=signin&callbackUrl=%2Fonboarding"
		);
		expect(
			unauthOnboardingResponse.headers.get("Content-Security-Policy")
		).toBeTruthy();

		const unauthDashboardResponse = proxy(
			new NextRequest("http://localhost:3000/dashboard/ai")
		);
		expect(unauthDashboardResponse.status).toBe(307);
		expect(unauthDashboardResponse.headers.get("location")).toBe(
			"http://localhost:3000/?auth=signin&callbackUrl=%2Fdashboard%2Fai"
		);

		const authRequest = new NextRequest("http://localhost:3000/onboarding", {
			headers: {
				cookie: "better-auth.session_token=valid-token",
			},
		});
		const authResponse = proxy(authRequest);
		expect(authResponse.status).toBe(200);
		expect(authResponse.headers.get("Content-Security-Policy")).toBeTruthy();

		const publicResponse = proxy(new NextRequest("http://localhost:3000/"));
		expect(publicResponse.status).toBe(200);
		expect(publicResponse.headers.get("Content-Security-Policy")).toBeTruthy();
	});
});
