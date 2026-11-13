import { describe, expect, test } from "bun:test";
import {
	ApiError,
	fetchWithTimeout,
	parseApiResponse,
} from "../src/lib/api-client";

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
});
