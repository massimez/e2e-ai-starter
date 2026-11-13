import { closeDb, db } from "@workspace/db";
import type { Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { env } from "./env";
import { logError, logInfo, logWarning } from "./lib/logger";
import {
	closeWorkerHealthRedis,
	createWorker,
	pingWorkerRedis,
} from "./lib/redis";
import {
	EMAIL_QUEUE_NAME,
	type EmailJobData,
	processEmailJob,
} from "./processors/email";
import {
	NOTIFICATION_QUEUE_NAME,
	type NotificationJobData,
	processNotificationJob,
} from "./processors/notification";

const SHUTDOWN_TIMEOUT_MS = 15_000;
const READINESS_TIMEOUT_MS = 3000;

logInfo("WorkerService", "Booting BullMQ workers", {
	concurrency: env.WORKER_CONCURRENCY,
	env: env.NODE_ENV,
});

const emailWorker = createWorker<EmailJobData>(
	EMAIL_QUEUE_NAME,
	processEmailJob
);
const notificationWorker = createWorker<NotificationJobData>(
	NOTIFICATION_QUEUE_NAME,
	processNotificationJob
);

function attachWorkerListeners(label: string, worker: Worker): void {
	worker.on("completed", (job) => {
		logInfo(label, "Job completed", {
			jobId: job.id,
			name: job.name,
		});
	});

	worker.on("failed", (job, err) => {
		logError(label, err, {
			attemptsMade: job?.attemptsMade,
			jobId: job?.id,
			name: job?.name,
		});
	});

	worker.on("stalled", (jobId) => {
		logWarning(label, "Job stalled and returned to queue", { jobId });
	});

	worker.on("error", (err) => {
		logError(label, err, { event: "worker_error" });
	});
}

attachWorkerListeners("EmailWorker", emailWorker);
attachWorkerListeners("NotificationWorker", notificationWorker);

logInfo("WorkerService", "Workers registered", {
	queues: [emailWorker.name, notificationWorker.name],
});

let isShuttingDown = false;

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Readiness check timed out")),
					timeoutMs
				);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

const healthServer =
	env.WORKER_HEALTH_PORT > 0
		? Bun.serve({
				fetch: async (req) => {
					const { pathname } = new URL(req.url);

					if (pathname === "/healthz" || pathname === "/live") {
						return Response.json(
							{
								service: "worker",
								status: isShuttingDown ? "draining" : "ok",
								timestamp: new Date().toISOString(),
								uptime: process.uptime(),
								workers: {
									email: emailWorker.isRunning(),
									notification: notificationWorker.isRunning(),
								},
							},
							{ status: isShuttingDown ? 503 : 200 }
						);
					}

					if (pathname === "/readyz") {
						if (isShuttingDown) {
							return Response.json(
								{ service: "worker", status: "draining" },
								{ status: 503 }
							);
						}

						const checks: Record<
							"database" | "redis",
							"healthy" | "unhealthy"
						> = {
							database: "healthy",
							redis: "healthy",
						};

						let isHealthy = true;

						try {
							await withTimeout(
								db.execute(sql`SELECT 1`),
								READINESS_TIMEOUT_MS
							);
						} catch {
							checks.database = "unhealthy";
							isHealthy = false;
						}

						try {
							const pong = await withTimeout(
								pingWorkerRedis(),
								READINESS_TIMEOUT_MS
							);
							if (pong !== "PONG") {
								checks.redis = "unhealthy";
								isHealthy = false;
							}
						} catch {
							checks.redis = "unhealthy";
							isHealthy = false;
						}

						return Response.json(
							{
								checks,
								service: "worker",
								status: isHealthy ? "ok" : "degraded",
								timestamp: new Date().toISOString(),
							},
							{ status: isHealthy ? 200 : 503 }
						);
					}

					return Response.json({ error: "Not found" }, { status: 404 });
				},
				hostname: env.WORKER_HEALTH_HOST,
				port: env.WORKER_HEALTH_PORT,
			})
		: null;

if (healthServer) {
	logInfo("WorkerService", "Health server listening", {
		url: `http://${healthServer.hostname}:${healthServer.port}/healthz`,
	});
}

async function shutdown(signal: string): Promise<void> {
	if (isShuttingDown) {
		logWarning("WorkerService", "Shutdown already in progress", { signal });
		return;
	}

	isShuttingDown = true;
	logInfo("WorkerService", "Draining active worker jobs", { signal });

	const forceExitTimer = setTimeout(() => {
		logError(
			"WorkerService",
			new Error("Worker shutdown exceeded timeout; forcing exit"),
			{ timeoutMs: SHUTDOWN_TIMEOUT_MS }
		);
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);

	if (typeof forceExitTimer.unref === "function") {
		forceExitTimer.unref();
	}

	try {
		healthServer?.stop(true);
		await Promise.all([emailWorker.close(), notificationWorker.close()]);
		await closeWorkerHealthRedis();
		await closeDb();
		clearTimeout(forceExitTimer);
		logInfo("WorkerService", "All workers shut down cleanly");
		process.exit(0);
	} catch (error) {
		clearTimeout(forceExitTimer);
		logError("WorkerService", error, { phase: "shutdown" });
		process.exit(1);
	}
}

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});
