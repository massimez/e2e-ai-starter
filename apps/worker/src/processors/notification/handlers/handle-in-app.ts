import { db } from "@workspace/db";
import { notification } from "@workspace/db/schema";
import { logInfo } from "../../../lib/logger";
import type { NotificationJobData } from "../types";

export async function handleInAppNotification(
	data: NotificationJobData,
	jobId?: string
): Promise<void> {
	const idempotencyKey =
		data.idempotencyKey ??
		(jobId ? `in_app:${data.userId}:${jobId}` : undefined);

	const query = db.insert(notification).values({
		category: data.category,
		content: data.content,
		data: data.data ?? {},
		...(idempotencyKey ? { idempotencyKey } : {}),
		organizationId: data.organizationId ?? null,
		title: data.title,
		type: data.type,
		userId: data.userId,
	});

	if (idempotencyKey) {
		await query.onConflictDoNothing({
			target: [notification.userId, notification.idempotencyKey],
		});
	} else {
		await query;
	}

	logInfo("NotificationWorker:InApp", "Processed in-app notification", {
		category: data.category,
		idempotencyKey,
		type: data.type,
		userId: data.userId,
	});
}
