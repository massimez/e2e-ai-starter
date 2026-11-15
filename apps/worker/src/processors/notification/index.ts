import { db } from "@workspace/db";
import { notificationPreference } from "@workspace/db/schema";
import { type Job, UnrecoverableError } from "bullmq";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { logInfo } from "../../lib/logger";
import { handleEmailNotification } from "./handlers/handle-email-notification";
import { handleInAppNotification } from "./handlers/handle-in-app";
import { handlePushNotification } from "./handlers/handle-push-notification";
import {
	NOTIFICATION_CHANNELS,
	type NotificationChannel,
	type NotificationJobData,
	notificationChannelSchema,
	notificationJobDataSchema,
} from "./types";

export * from "./types";

const deliveryStateSchema = z.object({
	channels: z.array(notificationChannelSchema).default([]),
	pushSubscriptionIds: z.array(z.string()).default([]),
});

function readDeliveryState(jobData: unknown) {
	if (typeof jobData !== "object" || jobData === null) {
		return { channels: [], pushSubscriptionIds: [] };
	}
	const rawState = (jobData as Record<string, unknown>)._deliveryState;
	const parsed = deliveryStateSchema.safeParse(rawState);
	return parsed.success
		? parsed.data
		: { channels: [], pushSubscriptionIds: [] };
}

export async function processNotificationJob(job: Job<NotificationJobData>) {
	const parsed = notificationJobDataSchema.safeParse(job.data);
	if (!parsed.success) {
		throw new UnrecoverableError(
			`Invalid notification job payload: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`
		);
	}

	const { data } = parsed;
	const { userId, category, type, title } = data;
	const priorState = readDeliveryState(job.data);
	const completedChannels = new Set<NotificationChannel>(priorState.channels);
	const deliveredPushSubIds = new Set<string>(priorState.pushSubscriptionIds);

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

	const pendingChannels = enabledChannels.filter(
		(channel) => !completedChannels.has(channel)
	);

	const channelResults = await Promise.allSettled(
		pendingChannels.map(async (channel) => {
			switch (channel) {
				case "in_app":
					await handleInAppNotification(data, job.id);
					completedChannels.add(channel);
					break;
				case "email":
					await handleEmailNotification(data, job.id);
					completedChannels.add(channel);
					break;
				case "push":
					await handlePushNotification(data, {
						deliveredSubscriptionIds: deliveredPushSubIds,
						onSubscriptionDelivered: (subscriptionId) => {
							deliveredPushSubIds.add(subscriptionId);
						},
					});
					completedChannels.add(channel);
					break;
				default:
					break;
			}
		})
	);

	if (typeof job.updateData === "function") {
		await job.updateData({
			...job.data,
			_deliveryState: {
				channels: Array.from(completedChannels),
				pushSubscriptionIds: Array.from(deliveredPushSubIds),
			},
		} as NotificationJobData);
	}

	const channelFailures = channelResults
		.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected"
		)
		.map((result) =>
			result.reason instanceof Error
				? result.reason
				: new Error(String(result.reason))
		);

	if (channelFailures.length === 1) {
		throw channelFailures[0];
	}
	if (channelFailures.length > 1) {
		throw new AggregateError(
			channelFailures,
			`${channelFailures.length} notification delivery channels failed`
		);
	}

	return {
		deliveredAt: new Date().toISOString(),
		deliveredChannels: enabledChannels.filter((channel) =>
			completedChannels.has(channel)
		),
		status: "success",
		userId,
	};
}
