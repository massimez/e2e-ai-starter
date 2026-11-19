import { parseRedisConnectionOptions } from "@workspace/shared/queues";
import {
	type ConnectionOptions,
	type Processor,
	Worker,
	type WorkerOptions,
} from "bullmq";
import Redis from "ioredis";
import { env } from "../env";
import { logError } from "./logger";

export function parseBullMqWorkerConnection(
	redisUrl: string
): ConnectionOptions {
	return {
		...parseRedisConnectionOptions(redisUrl),
		connectTimeout: 5000,
		// BullMQ requires `maxRetriesPerRequest: null` on worker blocking connections
		maxRetriesPerRequest: null,
	};
}

export const redisConnection: ConnectionOptions = parseBullMqWorkerConnection(
	env.REDIS_URL
);

export const queuePrefix = `{${env.REDIS_PREFIX}}`;

let healthRedisClient: Redis | null = null;

function createHealthRedisClient(): Redis {
	const client = new Redis(env.REDIS_URL, {
		connectTimeout: 3000,
		enableOfflineQueue: false,
		lazyConnect: true,
		maxRetriesPerRequest: 1,
		retryStrategy: (times) => (times <= 5 ? Math.min(times * 200, 2000) : null),
	});
	client.on("error", (err) => {
		logError("WorkerHealthRedis", err);
	});
	return client;
}

function getHealthRedisClient(): Redis {
	if (
		!healthRedisClient ||
		healthRedisClient.status === "end" ||
		healthRedisClient.status === "close"
	) {
		if (healthRedisClient) {
			healthRedisClient.disconnect();
		}
		healthRedisClient = createHealthRedisClient();
	}
	return healthRedisClient;
}

export async function pingWorkerRedis(): Promise<string> {
	const client = getHealthRedisClient();
	if (client.status === "wait") {
		await client.connect();
	}
	return await client.ping();
}

export async function closeWorkerHealthRedis(): Promise<void> {
	if (!healthRedisClient) {
		return;
	}
	const client = healthRedisClient;
	healthRedisClient = null;
	if (
		client.status === "wait" ||
		client.status === "end" ||
		client.status === "close"
	) {
		client.disconnect();
		return;
	}
	try {
		await client.quit();
	} catch {
		client.disconnect();
	}
}

export function createWorker<DataType = unknown, ResultType = unknown>(
	name: string,
	processor: Processor<DataType, ResultType>,
	options?: Omit<WorkerOptions, "connection">
) {
	return new Worker<DataType, ResultType>(name, processor, {
		concurrency: env.WORKER_CONCURRENCY,
		connection: redisConnection,
		prefix: queuePrefix,
		...options,
	});
}
