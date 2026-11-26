import { db } from "@workspace/db";
import {
	auditLog,
	organization,
	organizationStorageLimits,
	session,
	uploads,
	user,
} from "@workspace/db/schema";
import { and, count, eq, gt, gte, isNull, like, sql } from "drizzle-orm";
import { ACTIVE_USER_BAN_SQL, PLATFORM_ADMIN_ROLE_SQL } from "../shared";

export interface AdminOverviewMetrics {
	activeSessions: number;
	auditEvents24h: number;
	bannedUsers: number;
	committedFiles: number;
	platformAdmins: number;
	securityEvents24h: number;
	totalOrganizations: number;
	totalStorageLimitBytes: number;
	totalStorageUsedBytes: number;
	totalUsers: number;
	twoFactorEnabledUsers: number;
	verifiedUsers: number;
}

/**
 * Builds the Drizzle-backed repository for platform backoffice overview metrics.
 * Intentionally cross-tenant and guarded exclusively by `platformAdminMiddleware`.
 */
export function createDrizzleAdminOverviewRepository(database = db) {
	return {
		async getMetrics(now = new Date()): Promise<AdminOverviewMetrics> {
			const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

			const [userRows, sessionRows, orgRows, storageRows, fileRows, auditRows] =
				await Promise.all([
					database
						.select({
							bannedUsers: sql<number>`count(*) filter (where ${ACTIVE_USER_BAN_SQL})::int`,
							platformAdmins: sql<number>`count(*) filter (where ${PLATFORM_ADMIN_ROLE_SQL} AND NOT (${ACTIVE_USER_BAN_SQL}))::int`,
							totalUsers: count(),
							twoFactorEnabledUsers: sql<number>`count(*) filter (where ${user.twoFactorEnabled} = true)::int`,
							verifiedUsers: sql<number>`count(*) filter (where ${user.emailVerified} = true)::int`,
						})
						.from(user),
					database
						.select({ activeSessions: count() })
						.from(session)
						.where(gt(session.expiresAt, now)),
					database.select({ totalOrganizations: count() }).from(organization),
					database
						.select({
							totalStorageLimitBytes: sql<number>`coalesce(sum(${organizationStorageLimits.storageLimit}), 0)::bigint`,
							totalStorageUsedBytes: sql<number>`coalesce(sum(${organizationStorageLimits.currentUsage}), 0)::bigint`,
						})
						.from(organizationStorageLimits),
					database
						.select({ committedFiles: count() })
						.from(uploads)
						.where(
							and(eq(uploads.status, "committed"), isNull(uploads.deletedAt))
						),
					database
						.select({
							auditEvents24h: count(),
							securityEvents24h: sql<number>`count(*) filter (where ${like(auditLog.action, "security.%")})::int`,
						})
						.from(auditLog)
						.where(gte(auditLog.createdAt, since24h)),
				]);

			const [userStats] = userRows;
			const [storageStats] = storageRows;
			const [auditStats] = auditRows;

			return {
				activeSessions: Number(sessionRows[0]?.activeSessions ?? 0),
				auditEvents24h: Number(auditStats?.auditEvents24h ?? 0),
				bannedUsers: Number(userStats?.bannedUsers ?? 0),
				committedFiles: Number(fileRows[0]?.committedFiles ?? 0),
				platformAdmins: Number(userStats?.platformAdmins ?? 0),
				securityEvents24h: Number(auditStats?.securityEvents24h ?? 0),
				totalOrganizations: Number(orgRows[0]?.totalOrganizations ?? 0),
				totalStorageLimitBytes: Number(
					storageStats?.totalStorageLimitBytes ?? 0
				),
				totalStorageUsedBytes: Number(storageStats?.totalStorageUsedBytes ?? 0),
				totalUsers: Number(userStats?.totalUsers ?? 0),
				twoFactorEnabledUsers: Number(userStats?.twoFactorEnabledUsers ?? 0),
				verifiedUsers: Number(userStats?.verifiedUsers ?? 0),
			};
		},
	};
}

export type AdminOverviewRepository = ReturnType<
	typeof createDrizzleAdminOverviewRepository
>;

export const drizzleAdminOverviewRepository =
	createDrizzleAdminOverviewRepository();
