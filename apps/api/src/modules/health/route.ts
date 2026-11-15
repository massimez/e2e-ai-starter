import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
	createErrorResponse,
	createRouter,
	createSuccessResponse,
} from "../../lib/create-hono-app";
import { withTimeout } from "../../lib/queues";
import { redis } from "../../lib/redis/client";
import { rateLimiter } from "../../middleware/rate-limiter";

const READINESS_CHECK_TIMEOUT_MS = 3000;

function buildLivenessPayload() {
	return createSuccessResponse({
		service: "api",
		status: "ok" as const,
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
}

export const healthRoutes = createRouter()
	// Liveness probe (Kubernetes / ECS / Docker healthcheck)
	.get("/", (c) => c.json(buildLivenessPayload()))
	.get("/live", (c) => c.json(buildLivenessPayload()))
	// Readiness probe (verifies database & Redis connectivity)
	.get("/ready", rateLimiter(60_000, 60), async (c) => {
		const checks: {
			database: "healthy" | "unhealthy";
			redis: "healthy" | "unhealthy";
		} = {
			database: "healthy",
			redis: "healthy",
		};

		let isHealthy = true;

		// 1. Check PostgreSQL
		try {
			await withTimeout(db.execute(sql`SELECT 1`), READINESS_CHECK_TIMEOUT_MS);
		} catch {
			checks.database = "unhealthy";
			isHealthy = false;
		}

		// 2. Check Redis
		try {
			const pingResult = await withTimeout(
				redis.ping(),
				READINESS_CHECK_TIMEOUT_MS
			);
			if (pingResult !== "PONG") {
				checks.redis = "unhealthy";
				isHealthy = false;
			}
		} catch {
			checks.redis = "unhealthy";
			isHealthy = false;
		}

		const data = {
			checks,
			service: "api",
			status: isHealthy ? ("ok" as const) : ("degraded" as const),
			timestamp: new Date().toISOString(),
		};

		if (!isHealthy) {
			return c.json(
				{
					...createErrorResponse(
						"ServiceUnavailable",
						"One or more dependencies are unhealthy"
					),
					data,
				},
				503
			);
		}

		return c.json(createSuccessResponse(data), 200);
	});
