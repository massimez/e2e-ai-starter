import { parseRedisConnectionOptions } from "@workspace/api/queues";
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

function getHealthRedisClient(): Redis {
	if (!healthRedisClient) {
		healthRedisClient = new Redis(env.REDIS_URL, {
			connectTimeout: 3000,
			enableOfflineQueue: false,
			lazyConnect: true,
			maxRetriesPerRequest: 1,
		});
		healthRedisClient.on("error", (err) => {
			logError("WorkerHealthRedis", err);
		});
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
	try {
		await healthRedisClient.quit();
	} catch {
		healthRedisClient.disconnect();
	} finally {
		healthRedisClient = null;
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
