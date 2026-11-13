import { APP_CONFIG } from "@workspace/api/config";
import { sendEmail } from "../../../lib/email-sender";
import { escapeHtml, renderEmailLayout } from "../templates";
import type { EmailJobData } from "../types";

export async function handleWelcome(
	data: Extract<EmailJobData, { template: "welcome" }>,
	idempotencyKey?: string
): Promise<void> {
	const { to, payload, subject } = data;
	const name = payload.name?.trim() || "there";
	const safeName = escapeHtml(name);
	const safeAppName = escapeHtml(APP_CONFIG.name);

	const html = renderEmailLayout(`
		<h2 style="color: #111827; margin-bottom: 16px;">Welcome to ${safeAppName}, ${safeName}!</h2>
		<p style="color: #4b5563; font-size: 15px; line-height: 1.5;">We're thrilled to have you onboard. Your account is ready and fully configured.</p>
		<p style="color: #4b5563; font-size: 15px; line-height: 1.5;">You can now log in, join or create organizations, manage your team, and access file storage.</p>
	`);

	await sendEmail({
		html,
		idempotencyKey,
		subject: subject || `Welcome to ${APP_CONFIG.name}!`,
		text: `Welcome to ${APP_CONFIG.name}, ${name}! We're thrilled to have you onboard.`,
		to,
	});
}
