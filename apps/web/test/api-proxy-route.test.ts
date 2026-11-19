import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/[...path]/route";

describe("/api/[...path] runtime proxy route", () => {
	const originalInternal = process.env.INTERNAL_API_URL;
	const originalPublicApi = process.env.NEXT_PUBLIC_API_URL;

	afterEach(() => {
		mock.restore();
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

	test("resolves INTERNAL_API_URL at request time and forwards query, headers, and multiple Set-Cookie headers", async () => {
		process.env.INTERNAL_API_URL = "http://api-blue:3001";
		const capturedCalls: Array<{ init?: RequestInit; url: string }> = [];

		spyOn(globalThis, "fetch").mockImplementation(((
			input: RequestInfo | URL,
			init?: RequestInit
		) => {
			capturedCalls.push({ init, url: String(input) });
			const headers = new Headers({ "content-type": "application/json" });
			headers.append("set-cookie", "better-auth.session_token=abc; Path=/");
			headers.append("set-cookie", "active_org=org_1; Path=/");
			return Promise.resolve(
				new Response(JSON.stringify({ ok: true }), {
					headers,
					status: 200,
				})
			);
		}) as typeof fetch);

		const res1 = await GET(
			new NextRequest("http://localhost:3000/api/ai/threads?limit=10", {
				headers: {
					cookie: "better-auth.session_token=abc",
					"x-organization-id": "org_1",
				},
			})
		);

		expect(res1.status).toBe(200);
		expect(capturedCalls[0]?.url).toBe(
			"http://api-blue:3001/api/ai/threads?limit=10"
		);
		const forwardedHeaders = new Headers(capturedCalls[0]?.init?.headers);
		expect(forwardedHeaders.get("x-organization-id")).toBe("org_1");
		expect(forwardedHeaders.get("cookie")).toBe(
			"better-auth.session_token=abc"
		);
		expect(res1.headers.getSetCookie()).toEqual([
			"better-auth.session_token=abc; Path=/",
			"active_org=org_1; Path=/",
		]);

		process.env.INTERNAL_API_URL = "http://api-green:3002/";
		await POST(
			new NextRequest("http://localhost:3000/api/ai/chat", {
				body: JSON.stringify({ messages: [] }),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
		);
		expect(capturedCalls[1]?.url).toBe("http://api-green:3002/api/ai/chat");
		expect(capturedCalls[1]?.init?.redirect).toBe("manual");
	});

	test("returns structured 502 JSON envelope when upstream API is unreachable", async () => {
		process.env.INTERNAL_API_URL = "http://127.0.0.1:3999";
		spyOn(globalThis, "fetch").mockRejectedValueOnce(
			new Error("Connection refused")
		);

		const res = await GET(
			new NextRequest("http://localhost:3000/api/health/ready")
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as {
			error: { message: string; name: string };
			success: boolean;
		};
		expect(body.success).toBe(false);
		expect(body.error.name).toBe("BadGatewayError");
		expect(body.error.message).toContain("Connection refused");
	});
});
