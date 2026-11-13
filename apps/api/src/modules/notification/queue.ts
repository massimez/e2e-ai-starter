import type { JobsOptions } from "bullmq";
import {
	NOTIFICATION_QUEUE_NAME,
	type NotificationJobData,
	notificationJobDataSchema,
} from "../../lib/queues";
import { createQueue } from "../../lib/redis/queue";

export type { NotificationJobData } from "../../lib/queues";
export { NOTIFICATION_QUEUE_NAME } from "../../lib/queues";

export const notificationQueue = createQueue<NotificationJobData>(
	NOTIFICATION_QUEUE_NAME
);

export async function enqueueNotification(
	data: NotificationJobData,
	options?: JobsOptions
) {
	const validated = notificationJobDataSchema.parse(data);
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

	return await notificationQueue.addBulk(jobs);
}
