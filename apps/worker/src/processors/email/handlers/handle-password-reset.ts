import { sendEmail } from "../../../lib/email-sender";
import {
	escapeHtml,
	renderEmailLayout,
	renderPrimaryButton,
	sanitizeHttpUrl,
} from "../templates";
import type { EmailJobData } from "../types";

export async function handlePasswordReset(
	data: Extract<EmailJobData, { template: "reset-password" }>,
	idempotencyKey?: string
): Promise<void> {
	const { to, payload, subject } = data;
	const greeting = payload.name?.trim()
		? `Hi ${escapeHtml(payload.name.trim())}, `
		: "";
	const resetUrl = sanitizeHttpUrl(payload.url ?? payload.link);

	const html = renderEmailLayout(`
		<h2 style="color: #111827; margin-bottom: 16px;">Reset Your Password</h2>
		<p style="color: #4b5563; font-size: 15px; line-height: 1.5;">${greeting}We received a request to reset your password. Click the button below to set a new password:</p>
		${renderPrimaryButton(resetUrl.href, "Reset Password")}
		<p style="color: #9ca3af; font-size: 13px;">If you did not request a password reset, you can safely ignore this email.</p>
	`);

	await sendEmail({
		html,
		idempotencyKey,
		redactBodyInLogs: true,
		subject: subject || "Reset your password",
		text: `Reset your password by visiting: ${resetUrl.rawText}`,
		to,
	});
}
