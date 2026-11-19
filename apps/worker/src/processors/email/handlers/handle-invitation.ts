import { APP_CONFIG } from "@workspace/shared/config";
import { sendEmail } from "../../../lib/email-sender";
import {
	escapeHtml,
	renderEmailLayout,
	renderPrimaryButton,
	sanitizeHttpUrl,
} from "../templates";
import type { EmailJobData } from "../types";

export async function handleInvitation(
	data: Extract<EmailJobData, { template: "invitation" }>,
	idempotencyKey?: string
): Promise<void> {
	const { to, payload, subject } = data;
	const orgName = payload.organizationName?.trim() || "an organization";
	const safeOrgName = escapeHtml(orgName);
	const safeAppName = escapeHtml(APP_CONFIG.name);
	const inviterLabel = payload.inviterName?.trim()
		? ` by <strong>${escapeHtml(payload.inviterName.trim())}</strong>`
		: "";
	const roleLabel = payload.role?.trim()
		? ` as <strong>${escapeHtml(payload.role.trim())}</strong>`
		: "";
	const inviteUrl = sanitizeHttpUrl(payload.url ?? payload.link);

	const html = renderEmailLayout(`
		<h2 style="color: #111827; margin-bottom: 16px;">You've been invited!</h2>
		<p style="color: #4b5563; font-size: 15px; line-height: 1.5;">You have been invited${inviterLabel} to join <strong>${safeOrgName}</strong>${roleLabel} on ${safeAppName}.</p>
		${renderPrimaryButton(inviteUrl.href, "Accept Invitation")}
	`);

	await sendEmail({
		html,
		idempotencyKey,
		redactBodyInLogs: true,
		subject: subject || `You're invited to join ${orgName}`,
		text: `You have been invited to join ${orgName}. Accept invitation here: ${inviteUrl.rawText}`,
		to,
	});
}
