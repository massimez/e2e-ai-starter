import { db } from "@workspace/db";
import { pushSubscription } from "@workspace/db/schema";
import { decryptSecretValue } from "@workspace/shared/crypto";
import { UnrecoverableError } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "../../../env";
import { logError, logInfo, logWarning } from "../../../lib/logger";
import { PushDeliveryError, sendWebPush } from "../../../lib/push-sender";
import type { NotificationJobData } from "../types";

export interface HandlePushNotificationOptions {
	deliveredSubscriptionIds?: ReadonlySet<string>;
	onSubscriptionDelivered?: (subscriptionId: string) => void;
}

interface PushFanOutSummary {
	expiredSubIds: string[];
	retryableErrors: Error[];
	succeededCount: number;
	unrecoverableErrors: UnrecoverableError[];
}

function summarizePushResults(
	pendingSubs: readonly { id: string }[],
	results: readonly PromiseSettledResult<string>[],
	userId: string,
	onSubscriptionDelivered?: (subscriptionId: string) => void
): PushFanOutSummary {
	let succeededCount = 0;
	const expiredSubIds: string[] = [];
	const retryableErrors: Error[] = [];
	const unrecoverableErrors: UnrecoverableError[] = [];

	for (const [index, result] of results.entries()) {
		const sub = pendingSubs[index];
		if (!sub) {
			continue;
		}
		if (result.status === "fulfilled") {
			succeededCount += 1;
			onSubscriptionDelivered?.(sub.id);
			continue;
		}
		classifyPushFailure({
			expiredSubIds,
			reason: result.reason,
			retryableErrors,
			subscriptionId: sub.id,
			unrecoverableErrors,
			userId,
		});
	}

	return {
		expiredSubIds,
		retryableErrors,
		succeededCount,
		unrecoverableErrors,
	};
}

function classifyPushFailure(params: {
	expiredSubIds: string[];
	reason: unknown;
	retryableErrors: Error[];
	subscriptionId: string;
	unrecoverableErrors: UnrecoverableError[];
	userId: string;
}): void {
	const {
		expiredSubIds,
		reason,
		retryableErrors,
		subscriptionId,
		unrecoverableErrors,
		userId,
	} = params;

	if (reason instanceof PushDeliveryError && reason.isGone) {
		expiredSubIds.push(subscriptionId);
		logWarning(
			"NotificationWorker:Push",
			"Deleted expired Web Push subscription",
			{
				statusCode: reason.statusCode,
				subscriptionId,
				userId,
			}
		);
		return;
	}

	if (reason instanceof UnrecoverableError) {
		unrecoverableErrors.push(reason);
		logError("NotificationWorker:Push", reason, { subscriptionId, userId });
		return;
	}

	if (reason instanceof PushDeliveryError && reason.isPermanent) {
		unrecoverableErrors.push(new UnrecoverableError(reason.message));
		logError("NotificationWorker:Push", reason, {
			statusCode: reason.statusCode,
			subscriptionId,
			userId,
		});
		return;
	}

	const error = reason instanceof Error ? reason : new Error(String(reason));
	retryableErrors.push(error);
	logError("NotificationWorker:Push", error, { subscriptionId, userId });
}

function throwPushFanOutErrors(summary: PushFanOutSummary): void {
	const { retryableErrors, unrecoverableErrors } = summary;
	if (retryableErrors.length === 1) {
		throw retryableErrors[0];
	}
	if (retryableErrors.length > 1) {
		throw new AggregateError(
			retryableErrors,
			`${retryableErrors.length} push subscription deliveries failed`
		);
	}
	if (unrecoverableErrors.length === 1) {
		throw unrecoverableErrors[0];
	}
	if (unrecoverableErrors.length > 1) {
		throw new UnrecoverableError(
			`${unrecoverableErrors.length} push subscriptions rejected permanently: ${unrecoverableErrors.map((err) => err.message).join("; ")}`
		);
	}
}

export async function handlePushNotification(
	data: NotificationJobData,
	options: HandlePushNotificationOptions = {}
): Promise<void> {
	const subs = await db
		.select()
		.from(pushSubscription)
		.where(eq(pushSubscription.userId, data.userId));

	const pendingSubs = options.deliveredSubscriptionIds
		? subs.filter((sub) => !options.deliveredSubscriptionIds?.has(sub.id))
		: subs;

	if (pendingSubs.length === 0) {
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
		pendingSubs.map(async (sub) => {
			await sendWebPush(
				{
					auth: decryptSecretValue(sub.keys.auth, env.ENCRYPTION_SECRET),
					endpoint: sub.endpoint,
					p256dh: decryptSecretValue(sub.keys.p256dh, env.ENCRYPTION_SECRET),
				},
				pushPayload
			);
			return sub.id;
		})
	);

	const summary = summarizePushResults(
		pendingSubs,
		results,
		data.userId,
		options.onSubscriptionDelivered
	);

	if (summary.expiredSubIds.length > 0) {
		await db
			.delete(pushSubscription)
			.where(
				and(
					eq(pushSubscription.userId, data.userId),
					inArray(pushSubscription.id, summary.expiredSubIds)
				)
			);
	}

	logInfo("NotificationWorker:Push", "Completed Web Push fan-out", {
		failedCount:
			summary.retryableErrors.length + summary.unrecoverableErrors.length,
		removedCount: summary.expiredSubIds.length,
		succeededCount: summary.succeededCount,
		totalSubscriptions: pendingSubs.length,
		userId: data.userId,
	});

	throwPushFanOutErrors(summary);
}
