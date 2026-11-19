import { logInfo } from "@workspace/shared/logger";
import {
	EMAIL_QUEUE_NAME,
	type EmailJobData,
	emailJobDataSchema,
} from "@workspace/shared/queues";
import type { JobsOptions } from "bullmq";
import { env } from "../../env";
import { createQueue } from "../../lib/redis/queue";

export type { EmailJobData } from "@workspace/shared/queues";
export { EMAIL_QUEUE_NAME } from "@workspace/shared/queues";

export const emailQueue = createQueue<EmailJobData>(EMAIL_QUEUE_NAME);

export async function enqueueEmail(data: EmailJobData, options?: JobsOptions) {
	const validated = emailJobDataSchema.parse(data);
	if (env.QUEUE_DRIVER === "inline" && env.NODE_ENV !== "production") {
		if (env.NODE_ENV === "development") {
			console.info(
				`[Dev Email Inline] template=${validated.template} to=${validated.to} subject=${validated.subject}`,
				validated.payload
			);
		} else {
			logInfo("EmailQueue:Inline", `Delivered ${validated.template} inline`, {
				subject: validated.subject,
				to: validated.to,
			});
		}
		return { id: `inline-${crypto.randomUUID()}`, name: validated.template };
	}
	return await emailQueue.add(validated.template, validated, options);
}

const TRAILING_SLASH_REGEX = /\/$/u;

export async function enqueueWorkspaceInvitationEmail(params: {
	corsOrigins: readonly string[];
	email: string;
	invitationId: string;
	inviterName: string;
	organizationName: string;
	role: string;
}) {
	const appOrigin = (params.corsOrigins[0] ?? "http://localhost:3000").replace(
		TRAILING_SLASH_REGEX,
		""
	);
	const inviteUrl = `${appOrigin}/accept-invitation?invitationId=${encodeURIComponent(params.invitationId)}`;
	await enqueueEmail({
		payload: {
			inviterName: params.inviterName,
			organizationName: params.organizationName,
			role: params.role,
			url: inviteUrl,
		},
		subject: `You're invited to join ${params.organizationName}`,
		template: "invitation",
		to: params.email,
	});
}
