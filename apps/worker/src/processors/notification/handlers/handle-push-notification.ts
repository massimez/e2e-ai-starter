import { db } from "@workspace/db";
import { pushSubscription } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logError, logInfo, logWarning } from "../../../lib/logger";
import { PushDeliveryError, sendWebPush } from "../../../lib/push-sender";
import type { NotificationJobData } from "../types";

export async function handlePushNotification(
	data: NotificationJobData
): Promise<void> {
	const subs = await db
		.select()
		.from(pushSubscription)
		.where(eq(pushSubscription.userId, data.userId));

	if (subs.length === 0) {
		return;
	}

	const rawLink = data.data?.link;
	const pushPayload = {
		body: data.content,
		data: data.data,
		link: typeof rawLink === "string" ? rawLink : undefined,
		title: data.title,
	};

	const results = await Promise.allSettled(
		subs.map(async (sub) => {
			await sendWebPush(
				{
					auth: sub.keys.auth,
					endpoint: sub.endpoint,
					p256dh: sub.keys.p256dh,
				},
				pushPayload
			);
			return sub.id;
		})
	);

	let succeededCount = 0;
	const expiredSubIds: string[] = [];
	const retryableErrors: Error[] = [];

	for (const [index, result] of results.entries()) {
		const sub = subs[index];
		if (!sub) {
			continue;
		}

		if (result.status === "fulfilled") {
			succeededCount += 1;
			continue;
		}

		const { reason } = result;
		if (reason instanceof PushDeliveryError && reason.isGone) {
			expiredSubIds.push(sub.id);
			logWarning(
				"NotificationWorker:Push",
				"Deleted expired Web Push subscription",
				{
					statusCode: reason.statusCode,
					subscriptionId: sub.id,
					userId: data.userId,
				}
			);
			continue;
		}

		const error = reason instanceof Error ? reason : new Error(String(reason));
		retryableErrors.push(error);
		logError("NotificationWorker:Push", error, {
			subscriptionId: sub.id,
			userId: data.userId,
		});
	}

	if (expiredSubIds.length > 0) {
		await db
			.delete(pushSubscription)
			.where(
				and(
					eq(pushSubscription.userId, data.userId),
					inArray(pushSubscription.id, expiredSubIds)
				)
			);
	}

	const removedCount = expiredSubIds.length;

	logInfo("NotificationWorker:Push", "Completed Web Push fan-out", {
		failedCount: retryableErrors.length,
		removedCount,
		succeededCount,
		totalSubscriptions: subs.length,
		userId: data.userId,
	});

	if (succeededCount === 0 && retryableErrors.length > 0) {
		throw retryableErrors[0];
	}
}
