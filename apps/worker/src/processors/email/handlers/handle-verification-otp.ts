import { sendEmail } from "../../../lib/email-sender";
import { escapeHtml, renderEmailLayout } from "../templates";
import type { EmailJobData } from "../types";

export async function handleVerificationOtp(
	data: Extract<EmailJobData, { template: "verification-otp" }>,
	idempotencyKey?: string
): Promise<void> {
	const { to, payload, subject } = data;
	const safeCode = escapeHtml(payload.code);
	const safeType = escapeHtml(payload.type || "verification");

	const html = renderEmailLayout(`
		<h2 style="color: #111827; margin-bottom: 16px;">Your Authentication Code</h2>
		<p style="color: #4b5563; font-size: 15px; line-height: 1.5;">Use the one-time code below to complete your ${safeType} request:</p>
		<div style="margin: 24px 0; padding: 16px; background-color: #f3f4f6; border-radius: 6px; text-align: center; letter-spacing: 6px; font-size: 28px; font-weight: bold; color: #1f2937;">
			${safeCode}
		</div>
		<p style="color: #9ca3af; font-size: 13px;">This code expires in 10 minutes. If you did not request this, please disregard this email.</p>
	`);

	await sendEmail({
		html,
		idempotencyKey,
		redactBodyInLogs: true,
		subject: subject || "Your One-Time Verification Code",
		text: `Your verification code is: ${payload.code}. It expires in 10 minutes.`,
		to,
	});
}
