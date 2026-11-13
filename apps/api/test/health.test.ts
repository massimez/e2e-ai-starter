import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { healthRoutes } from "../src/modules/health/route";

function createHealthApp() {
	return new Hono().route("/health", healthRoutes);
}

describe("health probes", () => {
	test("GET /health returns liveness 200 OK", async () => {
		const app = createHealthApp();
		const res = await app.request("/health");

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { service: string; status: string };
			success: boolean;
		};
		expect(body.success).toBe(true);
		expect(body.data.status).toBe("ok");
		expect(body.data.service).toBe("api");
	});

	test("GET /health/live returns liveness 200 OK", async () => {
		const app = createHealthApp();
		const res = await app.request("/health/live");

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { service: string; status: string; uptime: number };
			success: boolean;
		};
		expect(body.success).toBe(true);
		expect(body.data.status).toBe("ok");
		expect(typeof body.data.uptime).toBe("number");
	});
});
