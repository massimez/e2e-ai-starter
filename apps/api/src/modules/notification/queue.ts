import {
	NOTIFICATION_QUEUE_NAME,
	type NotificationJobData,
	notificationJobDataSchema,
} from "@workspace/shared/queues";
import type { JobsOptions } from "bullmq";
import { env } from "../../env";
import { createQueue } from "../../lib/redis/queue";

export type { NotificationJobData } from "@workspace/shared/queues";
export { NOTIFICATION_QUEUE_NAME } from "@workspace/shared/queues";

export const notificationQueue = createQueue<NotificationJobData>(
	NOTIFICATION_QUEUE_NAME
);

export async function enqueueNotification(
	data: NotificationJobData,
	options?: JobsOptions
) {
	const validated = notificationJobDataSchema.parse(data);
	if (env.QUEUE_DRIVER === "inline" && env.NODE_ENV !== "production") {
		return { id: `inline-${crypto.randomUUID()}`, name: validated.type };
	}
	return await notificationQueue.add(validated.type, validated, options);
}

export async function enqueueNotificationsBulk(
	items: Array<{ data: NotificationJobData; options?: JobsOptions }>
) {
	if (items.length === 0) {
		return [];
	}

	const jobs = items.map((item) => {
		const validated = notificationJobDataSchema.parse(item.data);
		return {
			data: validated,
			name: validated.type,
			opts: item.options,
		};
	});

	if (env.QUEUE_DRIVER === "inline" && env.NODE_ENV !== "production") {
		return jobs.map((job) => ({
			id: `inline-${crypto.randomUUID()}`,
			name: job.name,
		}));
	}

	return await notificationQueue.addBulk(jobs);
}
