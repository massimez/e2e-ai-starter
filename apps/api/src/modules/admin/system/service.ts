import { db } from "@workspace/db";
import { logError } from "@workspace/shared/logger";
import {
	EMAIL_QUEUE_NAME,
	NOTIFICATION_QUEUE_NAME,
	RETENTION_QUEUE_NAME,
	type RetentionJobData,
	retentionJobDataSchema,
	withTimeout,
} from "@workspace/shared/queues";
import type { Queue } from "bullmq";
import { sql } from "drizzle-orm";
import { env } from "../../../env";
import { ValidationError } from "../../../lib/errors";
import { redis } from "../../../lib/redis/client";
import { createQueue } from "../../../lib/redis/queue";
import { emailQueue } from "../../email/queue";
import { notificationQueue } from "../../notification/queue";
import { hasConfiguredS3Credentials } from "../../storage/s3";

const HEALTH_TIMEOUT_MS = 2500;

export const retentionQueue =
	createQueue<RetentionJobData>(RETENTION_QUEUE_NAME);

export interface DependencyCheckStatus {
	detail: string;
	latencyMs: number | null;
	name: string;
	status: "healthy" | "degraded" | "unhealthy";
}

export interface QueueDepthSnapshot {
	counts: {
		active: number;
		completed: number;
		delayed: number;
		failed: number;
		waiting: number;
	} | null;
	error: string | null;
	mode: "inline" | "redis";
	name: string;
}

export interface AdminSystemDeps {
	checkDatabase: () => Promise<void>;
	checkRedis: () => Promise<string>;
	enqueueRetentionJob: (data: RetentionJobData) => Promise<{ id?: string }>;
	getQueueCounts: (
		queueName: string
	) => Promise<Record<string, number | undefined>>;
	queueDriver: "inline" | "redis";
	s3Bucket: string;
	s3Configured: boolean;
	s3Region: string;
	s3UseIamRole: boolean;
}

function getQueueByName(name: string): Queue {
	if (name === EMAIL_QUEUE_NAME) {
		return emailQueue as unknown as Queue;
	}
	if (name === NOTIFICATION_QUEUE_NAME) {
		return notificationQueue as unknown as Queue;
	}
	return retentionQueue as unknown as Queue;
}

const defaultSystemDeps: AdminSystemDeps = {
	checkDatabase: async () => {
		await db.execute(sql`SELECT 1`);
	},
	checkRedis: async () => await redis.ping(),
	enqueueRetentionJob: async (data) =>
		await retentionQueue.add("manual-retention-sweep", data),
	getQueueCounts: async (queueName) =>
		await getQueueByName(queueName).getJobCounts(
			"waiting",
			"active",
			"delayed",
			"failed",
			"completed"
		),
	queueDriver: env.QUEUE_DRIVER,
	s3Bucket: env.S3_BUCKET,
	s3Configured: hasConfiguredS3Credentials(),
	s3Region: env.S3_REGION,
	s3UseIamRole: env.S3_USE_IAM_ROLE,
};

function sanitizeInfraError(
	context: string,
	error: unknown,
	fallback: string
): string {
	logError(context, error);
	if (env.NODE_ENV === "production") {
		return fallback;
	}
	return error instanceof Error ? error.message : fallback;
}

async function measureCheck(
	name: string,
	fn: () => Promise<string>
): Promise<DependencyCheckStatus> {
	const startedAt = Date.now();
	try {
		const detail = await withTimeout(fn(), HEALTH_TIMEOUT_MS);
		return {
			detail,
			latencyMs: Date.now() - startedAt,
			name,
			status: "healthy",
		};
	} catch (error) {
		return {
			detail: sanitizeInfraError(
				`AdminSystem:${name}`,
				error,
				"Dependency check failed"
			),
			latencyMs: Date.now() - startedAt,
			name,
			status: "unhealthy",
		};
	}
}

const MONITORED_QUEUES = [
	EMAIL_QUEUE_NAME,
	NOTIFICATION_QUEUE_NAME,
	RETENTION_QUEUE_NAME,
] as const;

export function createAdminSystemService(
	deps: AdminSystemDeps = defaultSystemDeps
) {
	return {
		async getSystemStatus() {
			const [dbCheck, redisCheck] = await Promise.all([
				measureCheck("PostgreSQL", async () => {
					await deps.checkDatabase();
					return "Connected";
				}),
				measureCheck("Redis", async () => {
					const pong = await deps.checkRedis();
					if (pong !== "PONG") {
						throw new Error(`Unexpected response: ${pong}`);
					}
					return "Connected (PONG)";
				}),
			]);

			const s3Check: DependencyCheckStatus = {
				detail: deps.s3Configured
					? `Bucket ${deps.s3Bucket} (${deps.s3Region}${deps.s3UseIamRole ? ", IAM role" : ""})`
					: "S3 credentials not configured",
				latencyMs: null,
				name: "Object Storage (S3)",
				status: deps.s3Configured ? "healthy" : "degraded",
			};

			let queues: QueueDepthSnapshot[];
			if (deps.queueDriver === "inline") {
				queues = MONITORED_QUEUES.map((name) => ({
					counts: null,
					error: null,
					mode: "inline",
					name,
				}));
			} else {
				queues = await Promise.all(
					MONITORED_QUEUES.map(async (name): Promise<QueueDepthSnapshot> => {
						try {
							const raw = await withTimeout(
								deps.getQueueCounts(name),
								HEALTH_TIMEOUT_MS
							);
							return {
								counts: {
									active: Number(raw.active ?? 0),
									completed: Number(raw.completed ?? 0),
									delayed: Number(raw.delayed ?? 0),
									failed: Number(raw.failed ?? 0),
									waiting: Number(raw.waiting ?? 0),
								},
								error: null,
								mode: "redis",
								name,
							};
						} catch (error) {
							return {
								counts: null,
								error: sanitizeInfraError(
									`AdminSystem:Queue:${name}`,
									error,
									"Unable to read queue counts"
								),
								mode: "redis",
								name,
							};
						}
					})
				);
			}

			const dependencies = [dbCheck, redisCheck, s3Check];
			const overallStatus = dependencies.some((d) => d.status === "unhealthy")
				? ("degraded" as const)
				: ("ok" as const);

			return {
				checkedAt: new Date().toISOString(),
				dependencies,
				environment: env.NODE_ENV,
				queueDriver: deps.queueDriver,
				queues,
				status: overallStatus,
				uptimeSeconds: Math.floor(process.uptime()),
			};
		},

		async triggerRetentionSweep() {
			if (deps.queueDriver !== "redis") {
				throw new ValidationError(
					"Manual retention sweeps require QUEUE_DRIVER=redis with the worker service running."
				);
			}

			const payload = retentionJobDataSchema.parse({ triggeredBy: "manual" });
			const job = await deps.enqueueRetentionJob(payload);
			return {
				enqueuedAt: new Date().toISOString(),
				jobId: job.id ?? null,
				queue: RETENTION_QUEUE_NAME,
				triggeredBy: payload.triggeredBy,
			};
		},
	};
}

export const adminSystemService = createAdminSystemService();
