import type { JobsOptions } from "bullmq";
import {
	EMAIL_QUEUE_NAME,
	type EmailJobData,
	emailJobDataSchema,
} from "../../lib/queues";
import { createQueue } from "../../lib/redis/queue";

export type { EmailJobData } from "../../lib/queues";
export { EMAIL_QUEUE_NAME } from "../../lib/queues";

export const emailQueue = createQueue<EmailJobData>(EMAIL_QUEUE_NAME);

export async function enqueueEmail(data: EmailJobData, options?: JobsOptions) {
	const validated = emailJobDataSchema.parse(data);
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
