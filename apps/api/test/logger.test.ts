import { describe, expect, test } from "bun:test";
import {
	createLogger,
	type LoggerSink,
	redactRequestLog,
	sanitizeRequestPath,
} from "@workspace/shared/logger";
import { Hono } from "hono";
import { parseApiEnv } from "../src/env";
import type { AppEnv } from "../src/lib/create-hono-app";
import { AppError, AuthError } from "../src/lib/errors";
import { httpLoggerMiddleware } from "../src/middleware/http-logger";
import { requestIdMiddleware } from "../src/middleware/request-id";

const PRETTY_LOG_REGEX =
	/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] INFO: \[WorkerService\] Workers registered \{"concurrency":5,"queues":\["email-queue","notification-queue"\]\}$/u;
const PRETTY_HTTP_OK_REGEX =
	/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] INFO: \[HTTP\] GET \/api\/auth\/get-session 200 \(4ms\) \{"requestId":"req_123"\}$/u;
const PRETTY_HTTP_SUBMS_REGEX =
	/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] INFO: \[HTTP\] GET \/api\/health 200 \(0\.4ms\)$/u;
const PRETTY_HTTP_SLOW_REGEX =
	/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] WARN: \[HTTP\] POST \/api\/storage 400 \(1\.25s\)$/u;

function createBufferedSink() {
	const entries: Array<{
		level: "debug" | "info" | "warn" | "error";
		line: string;
	}> = [];
	const sink: LoggerSink = {
		debug: (line) => entries.push({ level: "debug", line }),
		error: (line) => entries.push({ level: "error", line }),
		info: (line) => entries.push({ level: "info", line }),
		warn: (line) => entries.push({ level: "warn", line }),
	};
	return { entries, sink };
}

describe("request path and log redaction", () => {
	test("preserves Better Auth route names while redacting token path segments", () => {
		expect(sanitizeRequestPath("/api/auth/get-session")).toBe(
			"/api/auth/get-session"
		);
		expect(
			sanitizeRequestPath("/api/auth/organization/get-full-organization")
		).toBe("/api/auth/organization/get-full-organization");
		expect(sanitizeRequestPath("/api/auth/admin/list-users")).toBe(
			"/api/auth/admin/list-users"
		);

		expect(sanitizeRequestPath("/api/auth/reset-password/secret-tok-123")).toBe(
			"/api/auth/reset-password/[REDACTED]"
		);
		expect(sanitizeRequestPath("/api/auth/verify-email/verify-tok-456")).toBe(
			"/api/auth/verify-email/[REDACTED]"
		);
		expect(sanitizeRequestPath("/api/invitations/inv-tok-789")).toBe(
			"/api/invitations/[REDACTED]"
		);
		expect(sanitizeRequestPath("/api/tokens/pat_999")).toBe(
			"/api/tokens/[REDACTED]"
		);
	});

	test("redacts secret query parameters while keeping safe query parameters", () => {
		expect(
			sanitizeRequestPath(
				"/api/auth/verify-email?token=abc123&callbackURL=%2Fdashboard"
			)
		).toBe("/api/auth/verify-email?token=[REDACTED]&callbackURL=%2Fdashboard");

		expect(
			sanitizeRequestPath(
				"/api/storage/presign?key=org%2Fa.png&expires=1700&sig=deadbeef"
			)
		).toBe("/api/storage/presign?key=org%2Fa.png&expires=1700&sig=[REDACTED]");

		expect(sanitizeRequestPath("/api/storage?limit=20&offset=40")).toBe(
			"/api/storage?limit=20&offset=40"
		);
	});

	test("scrubs URL credentials, JWTs, and Bearer headers in raw strings", () => {
		const raw =
			"GET /api/auth/get-session?code=123456 target=redis://admin:s3cr3t@redis:6379 auth=Bearer tok123 jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
		const scrubbed = redactRequestLog(raw);

		expect(scrubbed).toContain("/api/auth/get-session");
		expect(scrubbed).toContain("code=[REDACTED]");
		expect(scrubbed).toContain("redis://[REDACTED]@redis:6379");
		expect(scrubbed).toContain("Bearer [REDACTED]");
		expect(scrubbed).toContain("[REDACTED_JWT]");
		expect(scrubbed).not.toContain("s3cr3t");
		expect(scrubbed).not.toContain("123456");
	});
});

describe("structured logger formatting and levels", () => {
	test("emits consistent flat JSON logs across services and unwraps AggregateError", () => {
		const { entries, sink } = createBufferedSink();
		const logger = createLogger({
			colors: false,
			format: "json",
			includeStack: false,
			level: "debug",
			service: "worker",
			sink,
		});

		logger.logInfo("WorkerService", "Workers registered", {
			concurrency: 5,
			fileKey: "org_1/report.pdf",
			idempotencyKey: "email:42",
			keyPrefix: "prefix_12",
			message: "ignored-override",
			otpCode: "654321",
			password: "super-secret-password",
			queues: ["email-queue", "notification-queue"],
			redisUrl: "redis://user:pass@localhost:6379",
			statusCode: 201,
		});

		const emptyAggregateMessage = "";
		const agg = Object.assign(
			new AggregateError(
				[
					new Error("connect ECONNREFUSED ::1:6379"),
					new Error("connect ECONNREFUSED 127.0.0.1:6379"),
				],
				emptyAggregateMessage
			),
			{ code: "ECONNREFUSED" }
		);
		logger.logError("RedisClient", agg, { target: "redis://localhost:6379" });

		expect(entries).toHaveLength(2);
		const infoPayload = JSON.parse(entries[0]?.line ?? "{}") as Record<
			string,
			unknown
		>;
		expect(infoPayload.level).toBe("info");
		expect(infoPayload.service).toBe("worker");
		expect(infoPayload.context).toBe("WorkerService");
		expect(infoPayload.message).toBe("Workers registered");
		expect(infoPayload.otpCode).toBe("[REDACTED]");
		expect(infoPayload.password).toBe("[REDACTED]");
		expect(infoPayload.redisUrl).toBe("redis://[REDACTED]@localhost:6379");
		expect(infoPayload.fileKey).toBe("org_1/report.pdf");
		expect(infoPayload.idempotencyKey).toBe("email:42");
		expect(infoPayload.statusCode).toBe(201);
		expect(infoPayload.concurrency).toBe(5);

		const errorPayload = JSON.parse(entries[1]?.line ?? "{}") as {
			code?: string;
			error: {
				code?: string;
				errors?: string[];
				message: string;
				stack?: string;
			};
			level: string;
			message: string;
			service: string;
		};
		expect(errorPayload.level).toBe("error");
		expect(errorPayload.service).toBe("worker");
		expect(errorPayload.code).toBe("ECONNREFUSED");
		expect(errorPayload.error.code).toBe("ECONNREFUSED");
		expect(errorPayload.message).toBe(
			"connect ECONNREFUSED ::1:6379; connect ECONNREFUSED 127.0.0.1:6379"
		);
		expect(errorPayload.error.message).toBe(errorPayload.message);
		expect(errorPayload.error.stack).toBeUndefined();
	});

	test("handles circular metadata and BigInt values safely", () => {
		const { entries, sink } = createBufferedSink();
		const logger = createLogger({
			colors: false,
			format: "json",
			level: "info",
			sink,
		});

		const circular: Record<string, unknown> = { count: BigInt(99) };
		circular.self = circular;

		logger.logInfo("MetaTest", "Complex metadata", { payload: circular });

		const parsed = JSON.parse(entries[0]?.line ?? "{}") as {
			payload: { count: string; self: string };
		};
		expect(parsed.payload.count).toBe("99");
		expect(parsed.payload.self).toBe("[Circular]");
	});

	test("renders clean single-line pretty logs in development mode", () => {
		const { entries, sink } = createBufferedSink();
		const logger = createLogger({
			colors: false,
			format: "pretty",
			includeStack: true,
			level: "debug",
			service: "api",
			sink,
		});

		logger.logInfo("WorkerService", "Workers registered", {
			concurrency: 5,
			queues: ["email-queue", "notification-queue"],
		});
		logger.logHttp({
			durationMs: 4.2,
			method: "GET",
			path: "/api/auth/get-session",
			requestId: "req_123",
			status: 200,
		});
		logger.logHttp({
			durationMs: 0.4,
			method: "GET",
			path: "/api/health",
			status: 200,
		});
		logger.logHttp({
			durationMs: 1250,
			method: "POST",
			path: "/api/storage",
			status: 400,
		});

		expect(entries[0]?.line).toMatch(PRETTY_LOG_REGEX);
		expect(entries[1]?.line).toMatch(PRETTY_HTTP_OK_REGEX);
		expect(entries[2]?.line).toMatch(PRETTY_HTTP_SUBMS_REGEX);
		expect(entries[3]?.line).toMatch(PRETTY_HTTP_SLOW_REGEX);
	});

	test("filters messages below configured log level", () => {
		const { entries, sink } = createBufferedSink();
		const logger = createLogger({
			format: "pretty",
			level: "warn",
			sink,
		});

		logger.logDebug("Test", "debug");
		logger.logInfo("Test", "info");
		logger.logWarning("Test", "warn");
		logger.logError("Test", new Error("boom"));

		expect(entries.map((entry) => entry.level)).toEqual(["warn", "error"]);
	});
});

describe("httpLoggerMiddleware", () => {
	test("logs one completion entry with accurate status codes including handled 4xx AppErrors", async () => {
		const { entries, sink } = createBufferedSink();
		const testLogger = createLogger({
			colors: false,
			format: "json",
			level: "info",
			service: "api",
			sink,
		});

		const app = new Hono<AppEnv>()
			.use(requestIdMiddleware())
			.use(httpLoggerMiddleware({ logger: testLogger }))
			.get("/api/auth/get-session", (c) => c.json({ ok: true }))
			.get("/api/auth/organization/get-full-organization", () => {
				throw new AuthError("Unauthorized");
			})
			.get("/api/boom", () => {
				throw new AppError("Database failed", 500);
			})
			.onError((err, c) => {
				const status = err instanceof AppError ? err.statusCode : 500;
				return c.json({ error: err.message }, status as 401 | 500);
			});

		const okRes = await app.request("/api/auth/get-session", {
			headers: { "x-request-id": "req-ok-1" },
		});
		expect(okRes.status).toBe(200);

		const unauthRes = await app.request(
			"/api/auth/organization/get-full-organization?token=secret_123",
			{ headers: { "x-request-id": "req-auth-401" } }
		);
		expect(unauthRes.status).toBe(401);

		const errRes = await app.request("/api/boom", {
			headers: { "x-request-id": "req-boom-500" },
		});
		expect(errRes.status).toBe(500);

		expect(entries).toHaveLength(3);

		const log1 = JSON.parse(entries[0]?.line ?? "{}") as Record<
			string,
			unknown
		>;
		expect(log1.level).toBe("info");
		expect(log1.path).toBe("/api/auth/get-session");
		expect(log1.status).toBe(200);
		expect(log1.requestId).toBe("req-ok-1");

		const log2 = JSON.parse(entries[1]?.line ?? "{}") as Record<
			string,
			unknown
		>;
		expect(log2.level).toBe("warn");
		expect(log2.path).toBe(
			"/api/auth/organization/get-full-organization?token=[REDACTED]"
		);
		expect(log2.status).toBe(401);
		expect(log2.requestId).toBe("req-auth-401");

		const log3 = JSON.parse(entries[2]?.line ?? "{}") as Record<
			string,
			unknown
		>;
		expect(log3.level).toBe("error");
		expect(log3.path).toBe("/api/boom");
		expect(log3.status).toBe(500);
		expect(log3.requestId).toBe("req-boom-500");
	});
});

describe("logger environment configuration", () => {
	test("validates LOG_LEVEL and LOG_FORMAT in parseApiEnv", () => {
		const valid = parseApiEnv({
			LOG_FORMAT: "JSON",
			LOG_LEVEL: "DEBUG",
			NODE_ENV: "development",
		});
		expect(valid.LOG_FORMAT).toBe("json");
		expect(valid.LOG_LEVEL).toBe("debug");

		const blank = parseApiEnv({
			LOG_FORMAT: "",
			LOG_LEVEL: "",
			NODE_ENV: "development",
		});
		expect(blank.LOG_FORMAT).toBeUndefined();
		expect(blank.LOG_LEVEL).toBeUndefined();

		expect(() =>
			parseApiEnv({
				LOG_LEVEL: "verbose",
				NODE_ENV: "development",
			})
		).toThrow("Invalid API environment variables");
	});
});
