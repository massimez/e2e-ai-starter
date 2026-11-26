import { closeDb, db } from "@workspace/db";
import { withTimeout } from "@workspace/shared/queues";
import { Queue, type Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { env } from "./env";
import { logError, logInfo, logWarning } from "./lib/logger";
import {
	closeWorkerHealthRedis,
	createWorker,
	pingWorkerRedis,
	queuePrefix,
	redisConnection,
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
import {
	processRetentionJob,
	RETENTION_QUEUE_NAME,
	type RetentionJobData,
} from "./processors/retention";

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
const retentionWorker = createWorker<RetentionJobData>(
	RETENTION_QUEUE_NAME,
	processRetentionJob,
	{ concurrency: 1 }
);
const retentionQueue = new Queue<RetentionJobData>(RETENTION_QUEUE_NAME, {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { delay: 5000, type: "exponential" },
		removeOnComplete: { count: 100 },
		removeOnFail: { count: 500 },
	},
	prefix: queuePrefix,
});

retentionQueue.on("error", (err) => {
	logError("RetentionQueue", err, { event: "queue_error" });
});

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
attachWorkerListeners("RetentionWorker", retentionWorker);

void retentionQueue
	.upsertJobScheduler(
		"daily-data-retention",
		{ pattern: "0 3 * * *" },
		{
			data: { triggeredBy: "schedule" },
			name: "scheduled-retention",
		}
	)
	.then(() => {
		logInfo("RetentionWorker", "Scheduled daily data retention job", {
			cron: "0 3 * * *",
		});
	})
	.catch((error) => {
		logError("RetentionWorker", error, {
			phase: "register-retention-schedule",
		});
	});

logInfo("WorkerService", "Workers registered", {
	queues: [emailWorker.name, notificationWorker.name, retentionWorker.name],
});

let isShuttingDown = false;

function handleWorkerLivenessRequest(): Response {
	const workersHealthy =
		emailWorker.isRunning() &&
		notificationWorker.isRunning() &&
		retentionWorker.isRunning();
	let status = "degraded";
	if (isShuttingDown) {
		status = "draining";
	} else if (workersHealthy) {
		status = "ok";
	}
	return Response.json(
		{
			service: "worker",
			status,
			timestamp: new Date().toISOString(),
			uptime: process.uptime(),
			workers: {
				email: emailWorker.isRunning(),
				notification: notificationWorker.isRunning(),
				retention: retentionWorker.isRunning(),
			},
		},
		{ status: !isShuttingDown && workersHealthy ? 200 : 503 }
	);
}

const healthServer =
	env.WORKER_HEALTH_PORT > 0
		? Bun.serve({
				fetch: async (req) => {
					const { pathname } = new URL(req.url);

					if (pathname === "/healthz" || pathname === "/live") {
						return handleWorkerLivenessRequest();
					}

					if (pathname === "/readyz") {
						if (isShuttingDown) {
							return Response.json(
								{ service: "worker", status: "draining" },
								{ status: 503 }
							);
						}

						const [dbResult, redisResult] = await Promise.allSettled([
							withTimeout(db.execute(sql`SELECT 1`), READINESS_TIMEOUT_MS),
							withTimeout(pingWorkerRedis(), READINESS_TIMEOUT_MS),
						]);

						const checks: Record<
							"database" | "redis",
							"healthy" | "unhealthy"
						> = {
							database:
								dbResult.status === "fulfilled" ? "healthy" : "unhealthy",
							redis:
								redisResult.status === "fulfilled" &&
								redisResult.value === "PONG"
									? "healthy"
									: "unhealthy",
						};
						const isHealthy =
							checks.database === "healthy" && checks.redis === "healthy";

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

	let exitCode = 0;
	try {
		await healthServer?.stop(true);
		const workerResults = await Promise.allSettled([
			emailWorker.close(),
			notificationWorker.close(),
			retentionWorker.close(),
			retentionQueue.close(),
		]);
		for (const result of workerResults) {
			if (result.status === "rejected") {
				exitCode = 1;
				logError("WorkerService", result.reason, { phase: "shutdown-worker" });
			}
		}
		if (exitCode === 0) {
			logInfo("WorkerService", "All workers shut down cleanly");
		}
	} catch (error) {
		exitCode = 1;
		logError("WorkerService", error, { phase: "shutdown" });
	} finally {
		await Promise.allSettled([closeWorkerHealthRedis(), closeDb()]);
		clearTimeout(forceExitTimer);
		process.exit(exitCode);
	}
}

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});
