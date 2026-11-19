import { describe, expect, test } from "bun:test";
import type { AppType } from "@workspace/api/hc";
import { hc } from "hono/client";
import {
	ApiError,
	fetchWithTimeout,
	parseApiResponse,
} from "../src/lib/api-client";
import { orgHeadersInit } from "../src/lib/organization-hooks";

describe("@workspace/web api client helpers", () => {
	test("parseApiResponse unwraps success envelope data", async () => {
		const response = new Response(
			JSON.stringify({ data: { unreadCount: 3 }, success: true }),
			{
				headers: { "content-type": "application/json" },
				status: 200,
			}
		);

		const result = await parseApiResponse<{ unreadCount: number }>(response);
		expect(result).toEqual({ unreadCount: 3 });
	});

	test("parseApiResponse throws structured ApiError on failure envelope", async () => {
		const response = new Response(
			JSON.stringify({
				error: {
					issues: [
						{ code: "invalid_type", message: "Bad field", path: ["name"] },
					],
					message: "Validation failed",
					name: "ValidationError",
				},
				success: false,
			}),
			{
				headers: { "content-type": "application/json" },
				status: 400,
			}
		);

		try {
			await parseApiResponse(response);
			throw new Error("Expected ApiError");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			const apiError = error as ApiError;
			expect(apiError.status).toBe(400);
			expect(apiError.name).toBe("ValidationError");
			expect(apiError.message).toBe("Validation failed");
			expect(apiError.issues).toHaveLength(1);
		}
	});

	test("parseApiResponse falls back cleanly when body is non-JSON", async () => {
		const response = new Response("Bad Gateway", { status: 502 });

		await expect(parseApiResponse(response)).rejects.toThrow(
			"Request failed with status 502"
		);
	});

	test("fetchWithTimeout rejects immediately when user signal is aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			fetchWithTimeout("http://127.0.0.1:1/never", {
				signal: controller.signal,
			})
		).rejects.toThrow();
	});

	test("orgHeadersInit preserves Content-Type: application/json on Hono RPC JSON requests", async () => {
		let capturedHeaders: Headers | undefined;
		let capturedBody: BodyInit | null | undefined;

		const testClient = hc<AppType>("http://localhost:3000", {
			fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				capturedBody = init?.body;
				return Promise.resolve(
					new Response(JSON.stringify({ data: { id: "1" }, success: true }), {
						headers: { "content-type": "application/json" },
						status: 201,
					})
				);
			},
		});

		await testClient.api.storage.folders.$post(
			{ json: { name: "Documents" } },
			orgHeadersInit("org_123")
		);

		expect(capturedHeaders?.get("x-organization-id")).toBe("org_123");
		expect(capturedHeaders?.get("content-type")).toBe("application/json");
		expect(capturedBody).toBe(JSON.stringify({ name: "Documents" }));
	});
});
