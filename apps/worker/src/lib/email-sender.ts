import { UnrecoverableError } from "bullmq";
import { z } from "zod";
import { env } from "../env";
import { logInfo, logWarning } from "./logger";

const HEADER_INJECTION_REGEX = /[\r\n]+/gu;
const HTML_TAG_REGEX = /<[^>]*>/gu;
const OTP_CODE_REGEX = /\b\d{4,10}\b/gu;
const QUERY_SECRET_REGEX =
	/(?<prefix>[?&](?:token|code|secret|sig)=)[^&\s]+/giu;
const emailAddressSchema = z.string().trim().email();

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

export interface SendEmailOptions {
	html: string;
	idempotencyKey?: string;
	redactBodyInLogs?: boolean;
	subject: string;
	text?: string;
	to: string;
}

function sanitizeHeaderValue(value: string): string {
	return value.replace(HEADER_INJECTION_REGEX, " ").trim();
}

function redactSimulatedText(text: string): string {
	return text
		.replace(QUERY_SECRET_REGEX, "$<prefix>[REDACTED]")
		.replace(OTP_CODE_REGEX, "[REDACTED_CODE]");
}

export async function sendEmail(options: SendEmailOptions): Promise<{
	messageId: string;
	simulated: boolean;
}> {
	const to = sanitizeHeaderValue(options.to);
	const subject = sanitizeHeaderValue(options.subject);

	const emailCheck = emailAddressSchema.safeParse(to);
	if (!emailCheck.success) {
		throw new UnrecoverableError(`Invalid recipient email address: "${to}"`);
	}

	const plainText = options.text ?? options.html.replace(HTML_TAG_REGEX, "");

	if (env.RESEND_API_KEY) {
		const res = await fetch("https://api.resend.com/emails", {
			body: JSON.stringify({
				from: env.EMAIL_FROM,
				html: options.html,
				subject,
				text: plainText,
				to: [emailCheck.data],
			}),
			headers: {
				Authorization: `Bearer ${env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
				...(options.idempotencyKey
					? { "Idempotency-Key": options.idempotencyKey }
					: {}),
			},
			method: "POST",
			signal: AbortSignal.timeout(10_000),
		});

		if (!res.ok) {
			const errorText = (await res.text()).slice(0, 500);
			if (NON_RETRYABLE_STATUSES.has(res.status)) {
				throw new UnrecoverableError(
					`Resend rejected email (${res.status}): ${errorText}`
				);
			}
			throw new Error(`Resend API error (${res.status}): ${errorText}`);
		}

		const data = (await res.json()) as { id: string };
		logInfo("EmailSender:Resend", "Dispatched email", {
			messageId: data.id,
			recipientDomain: emailCheck.data.split("@")[1] ?? "unknown",
		});
		return { messageId: data.id, simulated: false };
	}

	if (env.NODE_ENV === "production") {
		throw new UnrecoverableError(
			"RESEND_API_KEY is not configured in production"
		);
	}

	logWarning("EmailSender:Simulator", "Simulated email dispatch (dev mode)", {
		preview: options.redactBodyInLogs
			? "[REDACTED_SENSITIVE_CONTENT]"
			: redactSimulatedText(plainText).slice(0, 240),
		recipientDomain: emailCheck.data.split("@")[1] ?? "unknown",
		subject,
	});

	if (env.NODE_ENV === "development") {
		console.info(
			`\n[Dev Email Simulator] To: ${emailCheck.data} | Subject: ${subject}\n${plainText}\n`
		);
	}

	return {
		messageId: `sim_${crypto.randomUUID()}`,
		simulated: true,
	};
}
