import { db } from "@workspace/db";
import {
	escapeLikePattern,
	invitation,
	member,
	organization,
	organizationStorageLimits,
	uploads,
	user,
} from "@workspace/db/schema";
import {
	and,
	count,
	desc,
	eq,
	ilike,
	inArray,
	isNull,
	or,
	type SQL,
} from "drizzle-orm";
import { toCountMap } from "../shared";

const DEFAULT_STORAGE_LIMIT_BYTES = 1_073_741_824; // 1 GB

export interface AdminOrganizationListItem {
	createdAt: Date;
	currentUsage: number;
	fileCount: number;
	id: string;
	logo: string | null;
	memberCount: number;
	name: string;
	pendingInvitationCount: number;
	slug: string | null;
	storageLimit: number;
}

export interface AdminOrganizationMemberItem {
	banned: boolean;
	createdAt: Date;
	email: string;
	memberId: string;
	name: string;
	role: string;
	twoFactorEnabled: boolean;
	userId: string;
}

export interface AdminOrganizationInvitationItem {
	createdAt: Date;
	email: string;
	expiresAt: Date;
	id: string;
	role: string;
	status: string;
}

export interface AdminOrganizationRecord {
	createdAt: Date;
	id: string;
	logo: string | null;
	name: string;
	slug: string | null;
}

function buildOrgWhereClause(search?: string): SQL | undefined {
	if (!search) {
		return undefined;
	}
	const pattern = `%${escapeLikePattern(search)}%`;
	return or(
		ilike(organization.name, pattern),
		ilike(organization.slug, pattern),
		ilike(organization.id, pattern)
	);
}

/**
 * Builds the Drizzle-backed repository for platform backoffice organization management.
 * Intentionally cross-tenant and guarded exclusively by `platformAdminMiddleware`.
 */
export function createDrizzleAdminOrganizationsRepository(database = db) {
	return {
		async findOrganizationById(
			organizationId: string
		): Promise<AdminOrganizationRecord | null> {
			const [row] = await database
				.select({
					createdAt: organization.createdAt,
					id: organization.id,
					logo: organization.logo,
					name: organization.name,
					slug: organization.slug,
				})
				.from(organization)
				.where(eq(organization.id, organizationId))
				.limit(1);
			return row ?? null;
		},

		async getOrganizationStorage(organizationId: string): Promise<{
			currentUsage: number;
			fileCount: number;
			storageLimit: number;
			updatedAt: Date | null;
		}> {
			const [limitRows, fileRows] = await Promise.all([
				database
					.select({
						currentUsage: organizationStorageLimits.currentUsage,
						storageLimit: organizationStorageLimits.storageLimit,
						updatedAt: organizationStorageLimits.updatedAt,
					})
					.from(organizationStorageLimits)
					.where(eq(organizationStorageLimits.organizationId, organizationId))
					.limit(1),
				database
					.select({ total: count() })
					.from(uploads)
					.where(
						and(
							eq(uploads.organizationId, organizationId),
							eq(uploads.status, "committed"),
							isNull(uploads.deletedAt)
						)
					),
			]);

			const [limitRow] = limitRows;
			return {
				currentUsage: Number(limitRow?.currentUsage ?? 0),
				fileCount: Number(fileRows[0]?.total ?? 0),
				storageLimit: Number(
					limitRow?.storageLimit ?? DEFAULT_STORAGE_LIMIT_BYTES
				),
				updatedAt: limitRow?.updatedAt ?? null,
			};
		},

		async listOrganizationInvitations(
			organizationId: string
		): Promise<AdminOrganizationInvitationItem[]> {
			return await database
				.select({
					createdAt: invitation.createdAt,
					email: invitation.email,
					expiresAt: invitation.expiresAt,
					id: invitation.id,
					role: invitation.role,
					status: invitation.status,
				})
				.from(invitation)
				.where(
					and(
						eq(invitation.organizationId, organizationId),
						eq(invitation.status, "pending")
					)
				)
				.orderBy(desc(invitation.createdAt), desc(invitation.id));
		},

		async listOrganizationMembers(
			organizationId: string
		): Promise<AdminOrganizationMemberItem[]> {
			const rows = await database
				.select({
					banned: user.banned,
					createdAt: member.createdAt,
					email: user.email,
					memberId: member.id,
					name: user.name,
					role: member.role,
					twoFactorEnabled: user.twoFactorEnabled,
					userId: user.id,
				})
				.from(member)
				.innerJoin(user, eq(member.userId, user.id))
				.where(eq(member.organizationId, organizationId))
				.orderBy(desc(member.createdAt), desc(member.id));

			return rows.map((row) => ({
				...row,
				banned: Boolean(row.banned),
				twoFactorEnabled: Boolean(row.twoFactorEnabled),
			}));
		},

		async listOrganizations(params: {
			limit: number;
			offset: number;
			search?: string;
		}): Promise<{ items: AdminOrganizationListItem[]; total: number }> {
			const whereClause = buildOrgWhereClause(params.search);

			const [rows, totalRows] = await Promise.all([
				database
					.select({
						createdAt: organization.createdAt,
						id: organization.id,
						logo: organization.logo,
						name: organization.name,
						slug: organization.slug,
					})
					.from(organization)
					.where(whereClause)
					.orderBy(desc(organization.createdAt), desc(organization.id))
					.limit(params.limit)
					.offset(params.offset),
				database
					.select({ total: count() })
					.from(organization)
					.where(whereClause),
			]);

			const orgIds = rows.map((row) => row.id);
			let memberCounts = new Map<string, number>();
			let inviteCounts = new Map<string, number>();
			let fileCounts = new Map<string, number>();
			const storageByOrg = new Map<
				string,
				{ currentUsage: number; storageLimit: number }
			>();

			if (orgIds.length > 0) {
				const [memberRows, inviteRows, fileRows, limitRows] = await Promise.all(
					[
						database
							.select({ organizationId: member.organizationId, total: count() })
							.from(member)
							.where(inArray(member.organizationId, orgIds))
							.groupBy(member.organizationId),
						database
							.select({
								organizationId: invitation.organizationId,
								total: count(),
							})
							.from(invitation)
							.where(
								and(
									inArray(invitation.organizationId, orgIds),
									eq(invitation.status, "pending")
								)
							)
							.groupBy(invitation.organizationId),
						database
							.select({
								organizationId: uploads.organizationId,
								total: count(),
							})
							.from(uploads)
							.where(
								and(
									inArray(uploads.organizationId, orgIds),
									eq(uploads.status, "committed"),
									isNull(uploads.deletedAt)
								)
							)
							.groupBy(uploads.organizationId),
						database
							.select({
								currentUsage: organizationStorageLimits.currentUsage,
								organizationId: organizationStorageLimits.organizationId,
								storageLimit: organizationStorageLimits.storageLimit,
							})
							.from(organizationStorageLimits)
							.where(inArray(organizationStorageLimits.organizationId, orgIds)),
					]
				);

				memberCounts = toCountMap(memberRows, (row) => row.organizationId);
				inviteCounts = toCountMap(inviteRows, (row) => row.organizationId);
				fileCounts = toCountMap(fileRows, (row) => row.organizationId);
				for (const row of limitRows) {
					storageByOrg.set(row.organizationId, {
						currentUsage: Number(row.currentUsage),
						storageLimit: Number(row.storageLimit),
					});
				}
			}

			return {
				items: rows.map((row) => {
					const storage = storageByOrg.get(row.id);
					return {
						createdAt: row.createdAt,
						currentUsage: storage?.currentUsage ?? 0,
						fileCount: fileCounts.get(row.id) ?? 0,
						id: row.id,
						logo: row.logo,
						memberCount: memberCounts.get(row.id) ?? 0,
						name: row.name,
						pendingInvitationCount: inviteCounts.get(row.id) ?? 0,
						slug: row.slug,
						storageLimit: storage?.storageLimit ?? DEFAULT_STORAGE_LIMIT_BYTES,
					};
				}),
				total: Number(totalRows[0]?.total ?? 0),
			};
		},

		async upsertStorageLimit(
			organizationId: string,
			storageLimitBytes: number
		): Promise<{
			currentUsage: number;
			organizationId: string;
			storageLimit: number;
			updatedAt: Date;
		}> {
			const [row] = await database
				.insert(organizationStorageLimits)
				.values({
					currentUsage: 0,
					organizationId,
					storageLimit: storageLimitBytes,
				})
				.onConflictDoUpdate({
					set: {
						storageLimit: storageLimitBytes,
						updatedAt: new Date(),
					},
					target: organizationStorageLimits.organizationId,
				})
				.returning({
					currentUsage: organizationStorageLimits.currentUsage,
					organizationId: organizationStorageLimits.organizationId,
					storageLimit: organizationStorageLimits.storageLimit,
					updatedAt: organizationStorageLimits.updatedAt,
				});

			if (!row) {
				throw new Error("Failed to update organization storage limit");
			}

			return {
				currentUsage: Number(row.currentUsage),
				organizationId: row.organizationId,
				storageLimit: Number(row.storageLimit),
				updatedAt: row.updatedAt,
			};
		},
	};
}

export type AdminOrganizationsRepository = ReturnType<
	typeof createDrizzleAdminOrganizationsRepository
>;

export const drizzleAdminOrganizationsRepository =
	createDrizzleAdminOrganizationsRepository();
