import { type Job, UnrecoverableError } from "bullmq";
import { logInfo } from "../../lib/logger";
import { handleInvitation } from "./handlers/handle-invitation";
import { handlePasswordReset } from "./handlers/handle-password-reset";
import { handleVerificationOtp } from "./handlers/handle-verification-otp";
import { handleWelcome } from "./handlers/handle-welcome";
import { type EmailJobData, emailJobDataSchema } from "./types";

export {
	EMAIL_QUEUE_NAME,
	type EmailJobData,
	emailJobDataSchema,
} from "./types";

export async function processEmailJob(job: Job<EmailJobData>) {
	const parsed = emailJobDataSchema.safeParse(job.data);
	if (!parsed.success) {
		throw new UnrecoverableError(
			`Invalid email job payload: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`
		);
	}

	const { data } = parsed;
	const idempotencyKey = job.id ? `email:${job.id}` : undefined;

	logInfo("EmailWorker", "Processing email job", {
		jobId: job.id,
		recipientDomain: data.to.split("@")[1] ?? "unknown",
		template: data.template,
	});

	switch (data.template) {
		case "verification-otp":
			await handleVerificationOtp(data, idempotencyKey);
			break;
		case "welcome":
			await handleWelcome(data, idempotencyKey);
			break;
		case "reset-password":
			await handlePasswordReset(data, idempotencyKey);
			break;
		case "invitation":
			await handleInvitation(data, idempotencyKey);
			break;
		default: {
			const exhaustiveCheck: never = data;
			throw new UnrecoverableError(
				`Unknown email template: ${String((exhaustiveCheck as { template?: unknown }).template)}`
			);
		}
	}

	return {
		deliveredAt: new Date().toISOString(),
		status: "sent",
		template: data.template,
	};
}
