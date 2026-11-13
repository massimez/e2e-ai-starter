import { db } from "@workspace/db";
import { user } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendEmail } from "../../../lib/email-sender";
import { logWarning } from "../../../lib/logger";
import {
	escapeHtml,
	renderEmailLayout,
	renderPrimaryButton,
	sanitizeHttpUrl,
} from "../../email/templates";
import type { NotificationJobData } from "../types";

export async function handleEmailNotification(
	data: NotificationJobData,
	jobId?: string
): Promise<void> {
	const [recipient] = await db
		.select({
			email: user.email,
			name: user.name,
		})
		.from(user)
		.where(eq(user.id, data.userId))
		.limit(1);

	if (!recipient?.email) {
		logWarning(
			"NotificationWorker:Email",
			"Skipped email notification because recipient was not found",
			{
				type: data.type,
				userId: data.userId,
			}
		);
		return;
	}

	const safeTitle = escapeHtml(data.title);
	const safeContent = escapeHtml(data.content);
	const rawLink = data.data?.link;
	const safeLink =
		typeof rawLink === "string" && rawLink.trim().length > 0
			? sanitizeHttpUrl(rawLink, "")
			: null;
	const actionBlock = safeLink?.href
		? renderPrimaryButton(safeLink.href, "View Details")
		: "";

	const html = renderEmailLayout(`
		<h2 style="color: #111827; margin-bottom: 12px;">${safeTitle}</h2>
		<p style="color: #4b5563; font-size: 15px; line-height: 1.5; white-space: pre-line;">${safeContent}</p>
		${actionBlock}
	`);

	const textParts = [data.title, "", data.content];
	if (safeLink?.rawText) {
		textParts.push("", `View details: ${safeLink.rawText}`);
	}

	await sendEmail({
		html,
		idempotencyKey: jobId ? `notif-email:${jobId}:${data.userId}` : undefined,
		subject: data.title,
		text: textParts.join("\n"),
		to: recipient.email,
	});
}
