import { describe, expect, test } from "bun:test";
import translations from "../src/components/auth/translations.json";
import {
	extractErrorMessage,
	sanitizeInternalRedirect,
} from "../src/lib/utils";

function collectLeafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
	const keys: string[] = [];
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			keys.push(...collectLeafKeys(value as Record<string, unknown>, path));
		} else {
			keys.push(path);
		}
	}
	return keys.sort();
}

describe("@workspace/ui error extraction and auth translations", () => {
	test("extractErrorMessage handles Better Auth, Hono envelope, string error, and fallbacks", async () => {
		expect(
			await extractErrorMessage(
				new Response(JSON.stringify({ message: "Invalid credentials" }), {
					status: 401,
				})
			)
		).toBe("Invalid credentials");

		expect(
			await extractErrorMessage(
				new Response(
					JSON.stringify({
						error: { message: "Quota exceeded" },
						success: false,
					}),
					{ status: 400 }
				)
			)
		).toBe("Quota exceeded");

		expect(
			await extractErrorMessage(
				new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 })
			)
		).toBe("Rate limited");

		expect(
			await extractErrorMessage(
				new Response("Plain upstream error", { status: 500 }),
				"Custom fallback"
			)
		).toBe("Plain upstream error");

		expect(
			await extractErrorMessage(
				new Response("", { status: 500 }),
				"Custom fallback"
			)
		).toBe("Custom fallback");

		expect(
			await extractErrorMessage(
				new Response(JSON.stringify({ ok: false }), { status: 500 }),
				"Custom fallback"
			)
		).toBe("Custom fallback");
	});

	test("translations.json keeps key parity across en, fr, and ar locales", () => {
		const enKeys = collectLeafKeys(translations.en);
		const frKeys = collectLeafKeys(translations.fr);
		const arKeys = collectLeafKeys(translations.ar);

		expect(frKeys).toEqual(enKeys);
		expect(arKeys).toEqual(enKeys);
		expect(enKeys).toContain("otpVerification.attempts_remaining_one");
		expect(enKeys).toContain("otpVerification.attempts_remaining_other");
	});

	test("sanitizeInternalRedirect allows only app-relative paths and rejects external/protocol-relative URLs", () => {
		expect(sanitizeInternalRedirect("/dashboard?tab=billing")).toBe(
			"/dashboard?tab=billing"
		);
		expect(sanitizeInternalRedirect("//evil.com")).toBeUndefined();
		expect(sanitizeInternalRedirect("https://evil.com")).toBeUndefined();
		expect(sanitizeInternalRedirect("javascript:alert(1)")).toBeUndefined();
		expect(sanitizeInternalRedirect("")).toBeUndefined();
		expect(sanitizeInternalRedirect(null)).toBeUndefined();
	});
});
