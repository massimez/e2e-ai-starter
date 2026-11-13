import { db } from "@workspace/db";
import { notificationPreference } from "@workspace/db/schema";
import { type Job, UnrecoverableError } from "bullmq";
import { and, eq } from "drizzle-orm";
import { logInfo } from "../../lib/logger";
import { handleEmailNotification } from "./handlers/handle-email-notification";
import { handleInAppNotification } from "./handlers/handle-in-app";
import { handlePushNotification } from "./handlers/handle-push-notification";
import {
	NOTIFICATION_CHANNELS,
	type NotificationChannel,
	type NotificationJobData,
	notificationJobDataSchema,
} from "./types";

export * from "./types";

export async function processNotificationJob(job: Job<NotificationJobData>) {
	const parsed = notificationJobDataSchema.safeParse(job.data);
	if (!parsed.success) {
		throw new UnrecoverableError(
			`Invalid notification job payload: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`
		);
	}

	const { data } = parsed;
	const { userId, category, type, title } = data;

	logInfo("NotificationWorker", "Processing notification job", {
		category,
		jobId: job.id,
		title,
		type,
		userId,
	});

	// Fetch user preferences for this category
	const prefs = await db
		.select()
		.from(notificationPreference)
		.where(
			and(
				eq(notificationPreference.userId, userId),
				eq(notificationPreference.category, category)
			)
		);

	const targetChannels: readonly NotificationChannel[] =
		data.channels ?? NOTIFICATION_CHANNELS;

	const enabledChannels = targetChannels.filter((channel) => {
		const pref = prefs.find((p) => p.channel === channel);
		const isEnabled = pref ? pref.enabled : true;

		if (!isEnabled) {
			logInfo("NotificationWorker", "Channel muted by user preference", {
				category,
				channel,
				userId,
			});
		}
		return isEnabled;
	});

	const deliveredChannels: NotificationChannel[] = [];

	await Promise.all(
		enabledChannels.map(async (channel) => {
			switch (channel) {
				case "in_app":
					await handleInAppNotification(data, job.id);
					deliveredChannels.push(channel);
					break;
				case "email":
					await handleEmailNotification(data, job.id);
					deliveredChannels.push(channel);
					break;
				case "push":
					await handlePushNotification(data);
					deliveredChannels.push(channel);
					break;
				default:
					break;
			}
		})
	);

	return {
		deliveredAt: new Date().toISOString(),
		deliveredChannels,
		status: "success",
		userId,
	};
}
