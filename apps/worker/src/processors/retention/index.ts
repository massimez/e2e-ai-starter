import { db } from "@workspace/db";
import {
	auditLog,
	invitation,
	notification,
	uploads,
	verification,
} from "@workspace/db/schema";
import {
	type RetentionJobData,
	retentionJobDataSchema,
} from "@workspace/shared/queues";
import { type Job, UnrecoverableError } from "bullmq";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { env } from "../../env";
import { logInfo } from "../../lib/logger";

export {
	RETENTION_QUEUE_NAME,
	type RetentionJobData,
} from "@workspace/shared/queues";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const INVITATION_ARCHIVE_DAYS = 30;

export interface RetentionCleanupSummary {
	abandonedUploadsMarkedFailed: number;
	expiredAuditLogsDeleted: number;
	expiredInvitationsDeleted: number;
	expiredInvitationsMarked: number;
	expiredVerificationsDeleted: number;
	oldReadNotificationsDeleted: number;
	ranAt: string;
}

export interface RunDataRetentionOptions {
	auditRetentionDays?: number;
	notificationRetentionDays?: number;
	now?: Date;
}

/**
 * Runs deterministic ISO 27001 A.8.10 / A.5.33 data retention cleanup across
 * verification tokens, invitations, abandoned uploads, old read notifications,
 * and expired audit logs (using `SET LOCAL app.audit_retention_prune = 'on'`).
 */
export async function runDataRetentionCleanup(
	options: RunDataRetentionOptions = {}
): Promise<RetentionCleanupSummary> {
	const now = options.now ?? new Date();
	const auditRetentionDays =
		options.auditRetentionDays ?? env.AUDIT_RETENTION_DAYS;
	const notificationRetentionDays =
		options.notificationRetentionDays ?? env.NOTIFICATION_RETENTION_DAYS;

	const invitationDeleteCutoff = new Date(
		now.getTime() - INVITATION_ARCHIVE_DAYS * MS_PER_DAY
	);
	const abandonedUploadCutoff = new Date(now.getTime() - MS_PER_HOUR);
	const notificationCutoff = new Date(
		now.getTime() - notificationRetentionDays * MS_PER_DAY
	);
	const auditCutoff = new Date(now.getTime() - auditRetentionDays * MS_PER_DAY);

	// 1. Delete expired verification tokens
	const deletedVerifications = await db
		.delete(verification)
		.where(lt(verification.expiresAt, now))
		.returning({ id: verification.id });

	// 2a. Mark expired pending invitations as 'expired'
	const markedInvitations = await db
		.update(invitation)
		.set({ status: "expired" })
		.where(and(eq(invitation.status, "pending"), lt(invitation.expiresAt, now)))
		.returning({ id: invitation.id });

	// 2b. Delete expired invitations older than 30 days past expiration
	const deletedInvitations = await db
		.delete(invitation)
		.where(
			and(
				eq(invitation.status, "expired"),
				lt(invitation.expiresAt, invitationDeleteCutoff)
			)
		)
		.returning({ id: invitation.id });

	// 3. Mark abandoned pending uploads as 'failed' after 1 hour past expiration
	const failedUploads = await db
		.update(uploads)
		.set({ status: "failed" })
		.where(
			and(
				eq(uploads.status, "pending"),
				isNull(uploads.deletedAt),
				lt(uploads.expiresAt, abandonedUploadCutoff)
			)
		)
		.returning({ id: uploads.id });

	// 4. Prune old read notifications beyond NOTIFICATION_RETENTION_DAYS
	const deletedNotifications = await db
		.delete(notification)
		.where(
			and(
				eq(notification.isRead, true),
				lt(notification.createdAt, notificationCutoff)
			)
		)
		.returning({ id: notification.id });

	// 5. Prune expired audit_log rows inside an authorized retention transaction
	const deletedAuditLogs = await db.transaction(async (tx) => {
		await tx.execute(sql`SET LOCAL app.audit_retention_prune = 'on'`);
		return await tx
			.delete(auditLog)
			.where(lt(auditLog.createdAt, auditCutoff))
			.returning({ id: auditLog.id });
	});

	const summary: RetentionCleanupSummary = {
		abandonedUploadsMarkedFailed: failedUploads.length,
		expiredAuditLogsDeleted: deletedAuditLogs.length,
		expiredInvitationsDeleted: deletedInvitations.length,
		expiredInvitationsMarked: markedInvitations.length,
		expiredVerificationsDeleted: deletedVerifications.length,
		oldReadNotificationsDeleted: deletedNotifications.length,
		ranAt: now.toISOString(),
	};

	logInfo("RetentionWorker", "Completed data retention cleanup", {
		...summary,
		auditRetentionDays,
		notificationRetentionDays,
	});

	return summary;
}

export async function processRetentionJob(
	job: Job<RetentionJobData>
): Promise<RetentionCleanupSummary> {
	const parsed = retentionJobDataSchema.safeParse(job.data ?? {});
	if (!parsed.success) {
		throw new UnrecoverableError(
			`Invalid retention job payload: ${parsed.error.message}`
		);
	}

	logInfo("RetentionWorker", "Starting data retention job", {
		jobId: job.id,
		triggeredBy: parsed.data.triggeredBy,
	});

	return await runDataRetentionCleanup();
}
