import { logError } from "@workspace/shared/logger";
import { parseRedisConnectionOptions } from "@workspace/shared/queues";
import { type ConnectionOptions, Queue, type QueueOptions } from "bullmq";
import { env } from "../../env";

export function parseBullMqConnection(redisUrl: string): ConnectionOptions {
	return {
		...parseRedisConnectionOptions(redisUrl),
		connectTimeout: 3000,
		enableOfflineQueue: false,
		maxRetriesPerRequest: 2,
	};
}

export const redisConnection: ConnectionOptions = parseBullMqConnection(
	env.REDIS_URL
);

export const queuePrefix = `{${env.REDIS_PREFIX}}`;

const registeredQueues = new Set<Queue>();

export function createQueue<DataType = unknown, ResultType = unknown>(
	name: string,
	options?: Omit<QueueOptions, "connection">
) {
	const queue = new Queue<DataType, ResultType>(name, {
		connection: redisConnection,
		defaultJobOptions: {
			attempts: 3,
			backoff: {
				delay: 1000,
				type: "exponential",
			},
			removeOnComplete: { count: 100 },
			removeOnFail: { count: 500 },
		},
		prefix: queuePrefix,
		...options,
	});

	queue.on("error", (err) => {
		logError(`Queue:${name}`, err);
	});

	registeredQueues.add(queue as unknown as Queue);
	return queue;
}

export async function closeQueues(): Promise<void> {
	const queues = Array.from(registeredQueues);
	registeredQueues.clear();
	await Promise.allSettled(queues.map((queue) => queue.close()));
}
