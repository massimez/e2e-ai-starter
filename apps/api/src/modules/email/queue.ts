import type { JobsOptions } from "bullmq";
import {
	EMAIL_QUEUE_NAME,
	type EmailJobData,
	emailJobDataSchema,
} from "../../lib/queues";
import { createQueue } from "../../lib/redis/queue";

export type { EmailJobData } from "../../lib/queues";
export { EMAIL_QUEUE_NAME } from "../../lib/queues";

export const emailQueue = createQueue<EmailJobData>(EMAIL_QUEUE_NAME);

export async function enqueueEmail(data: EmailJobData, options?: JobsOptions) {
	const validated = emailJobDataSchema.parse(data);
	return await emailQueue.add(validated.template, validated, options);
}
