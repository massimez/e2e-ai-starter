import { db } from "@workspace/db";
import {
	escapeLikePattern,
	member,
	organization,
	session,
	user,
} from "@workspace/db/schema";
import {
	and,
	count,
	desc,
	eq,
	gt,
	ilike,
	inArray,
	not,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { invalidateUserSessionCache } from "../../../lib/auth/secondary-storage";
import { isActiveUserBan } from "../../../middleware/auth";
import {
	ACTIVE_USER_BAN_SQL,
	ADMIN_MUTATION_ADVISORY_LOCK_KEY,
	PLATFORM_ADMIN_ROLE_SQL,
	toCountMap,
} from "../shared";

export interface AdminUserFilterParams {
	role?: "all" | "admin" | "user";
	search?: string;
	status?: "all" | "active" | "banned";
	twoFactor?: "all" | "enabled" | "disabled";
}

export interface AdminUserListItem {
	activeSessionCount: number;
	banExpires: Date | null;
	banned: boolean;
	banReason: string | null;
	createdAt: Date;
	email: string;
	emailVerified: boolean;
	id: string;
	image: string | null;
	name: string;
	organizationCount: number;
	role: string | null;
	twoFactorEnabled: boolean;
}

export interface AdminUserMembership {
	createdAt: Date;
	memberId: string;
	organizationId: string;
	organizationName: string;
	organizationSlug: string | null;
	role: string;
}

export interface AdminUserSessionItem {
	activeOrganizationId: string | null;
	createdAt: Date;
	expiresAt: Date;
	id: string;
	impersonatedBy: string | null;
	ipAddress: string | null;
	userAgent: string | null;
}

export interface AdminUserRecord {
	banExpires: Date | null;
	banned: boolean | null;
	banReason: string | null;
	createdAt: Date;
	email: string;
	emailVerified: boolean;
	id: string;
	image: string | null;
	name: string;
	role: string | null;
	twoFactorEnabled: boolean | null;
}

export interface AdminUserMutationTx {
	banUser: (params: {
		banExpires: Date | null;
		banReason: string;
		userId: string;
	}) => Promise<{ revokedTokens: string[]; updated: AdminUserRecord } | null>;
	countActivePlatformAdmins: () => Promise<number>;
	findUserById: (userId: string) => Promise<AdminUserRecord | null>;
	updateUserRole: (
		userId: string,
		role: "admin" | "user"
	) => Promise<{ activeTokens: string[]; updated: AdminUserRecord } | null>;
}

function buildUserWhereClause(params: AdminUserFilterParams): SQL | undefined {
	const conditions: Array<SQL | undefined> = [];

	if (params.role === "admin") {
		conditions.push(PLATFORM_ADMIN_ROLE_SQL);
	} else if (params.role === "user") {
		conditions.push(not(PLATFORM_ADMIN_ROLE_SQL));
	}

	if (params.status === "banned") {
		conditions.push(ACTIVE_USER_BAN_SQL);
	} else if (params.status === "active") {
		conditions.push(not(ACTIVE_USER_BAN_SQL));
	}

	if (params.twoFactor === "enabled") {
		conditions.push(eq(user.twoFactorEnabled, true));
	} else if (params.twoFactor === "disabled") {
		conditions.push(sql`coalesce(${user.twoFactorEnabled}, false) = false`);
	}

	if (params.search) {
		const pattern = `%${escapeLikePattern(params.search)}%`;
		conditions.push(
			or(
				ilike(user.name, pattern),
				ilike(user.email, pattern),
				ilike(user.id, pattern)
			)
		);
	}

	const defined = conditions.filter((item): item is SQL => item !== undefined);
	return defined.length > 0 ? and(...defined) : undefined;
}

const userSelectFields = {
	banExpires: user.banExpires,
	banned: user.banned,
	banReason: user.banReason,
	createdAt: user.createdAt,
	email: user.email,
	emailVerified: user.emailVerified,
	id: user.id,
	image: user.image,
	name: user.name,
	role: user.role,
	twoFactorEnabled: user.twoFactorEnabled,
};

type QueryRunner = Pick<typeof db, "delete" | "select" | "update">;

function createMutationTxAdapter(runner: QueryRunner): AdminUserMutationTx {
	return {
		async banUser(params) {
			const [updated] = await runner
				.update(user)
				.set({
					banExpires: params.banExpires,
					banned: true,
					banReason: params.banReason,
				})
				.where(eq(user.id, params.userId))
				.returning(userSelectFields);

			if (!updated) {
				return null;
			}

			const deletedSessions = await runner
				.delete(session)
				.where(eq(session.userId, params.userId))
				.returning({ token: session.token });

			return {
				revokedTokens: deletedSessions.map((entry) => entry.token),
				updated,
			};
		},

		async countActivePlatformAdmins() {
			const [row] = await runner
				.select({ total: count() })
				.from(user)
				.where(and(PLATFORM_ADMIN_ROLE_SQL, not(ACTIVE_USER_BAN_SQL)));
			return Number(row?.total ?? 0);
		},

		async findUserById(userId) {
			const [row] = await runner
				.select(userSelectFields)
				.from(user)
				.where(eq(user.id, userId))
				.limit(1);
			return row ?? null;
		},

		async updateUserRole(userId, role) {
			const [updated] = await runner
				.update(user)
				.set({ role })
				.where(eq(user.id, userId))
				.returning(userSelectFields);

			if (!updated) {
				return null;
			}

			const activeSessions = await runner
				.select({ token: session.token })
				.from(session)
				.where(eq(session.userId, userId));

			return {
				activeTokens: activeSessions.map((entry) => entry.token),
				updated,
			};
		},
	};
}

/**
 * Builds the Drizzle-backed repository for platform backoffice user management.
 * Intentionally cross-tenant and guarded exclusively by `platformAdminMiddleware`.
 */
export function createDrizzleAdminUsersRepository(database = db) {
	const rootAdapter = createMutationTxAdapter(database);

	async function deleteSessionsAndInvalidate(
		userId: string,
		whereClause: SQL
	): Promise<number> {
		const deleted = await database
			.delete(session)
			.where(whereClause)
			.returning({ token: session.token });
		if (deleted.length > 0) {
			await invalidateUserSessionCache(
				userId,
				deleted.map((entry) => entry.token)
			);
		}
		return deleted.length;
	}

	return {
		findUserById: (userId: string) => rootAdapter.findUserById(userId),

		invalidateUserSessionsCache: (userId: string, tokens: readonly string[]) =>
			invalidateUserSessionCache(userId, tokens),

		async listUserMemberships(userId: string): Promise<AdminUserMembership[]> {
			return await database
				.select({
					createdAt: member.createdAt,
					memberId: member.id,
					organizationId: organization.id,
					organizationName: organization.name,
					organizationSlug: organization.slug,
					role: member.role,
				})
				.from(member)
				.innerJoin(organization, eq(member.organizationId, organization.id))
				.where(eq(member.userId, userId))
				.orderBy(desc(member.createdAt), desc(member.id));
		},

		async listUsers(
			params: AdminUserFilterParams & { limit: number; offset: number }
		): Promise<{ items: AdminUserListItem[]; total: number }> {
			const whereClause = buildUserWhereClause(params);
			const now = new Date();

			const [rows, totalRows] = await Promise.all([
				database
					.select(userSelectFields)
					.from(user)
					.where(whereClause)
					.orderBy(desc(user.createdAt), desc(user.id))
					.limit(params.limit)
					.offset(params.offset),
				database.select({ total: count() }).from(user).where(whereClause),
			]);

			const userIds = rows.map((row) => row.id);
			let orgCountByUser = new Map<string, number>();
			let sessionCountByUser = new Map<string, number>();

			if (userIds.length > 0) {
				const [orgCounts, sessionCounts] = await Promise.all([
					database
						.select({ total: count(), userId: member.userId })
						.from(member)
						.where(inArray(member.userId, userIds))
						.groupBy(member.userId),
					database
						.select({ total: count(), userId: session.userId })
						.from(session)
						.where(
							and(inArray(session.userId, userIds), gt(session.expiresAt, now))
						)
						.groupBy(session.userId),
				]);

				orgCountByUser = toCountMap(orgCounts, (entry) => entry.userId);
				sessionCountByUser = toCountMap(sessionCounts, (entry) => entry.userId);
			}

			return {
				items: rows.map((row) => ({
					activeSessionCount: sessionCountByUser.get(row.id) ?? 0,
					banExpires: row.banExpires,
					banned: isActiveUserBan(row),
					banReason: row.banReason,
					createdAt: row.createdAt,
					email: row.email,
					emailVerified: row.emailVerified,
					id: row.id,
					image: row.image,
					name: row.name,
					organizationCount: orgCountByUser.get(row.id) ?? 0,
					role: row.role,
					twoFactorEnabled: Boolean(row.twoFactorEnabled),
				})),
				total: Number(totalRows[0]?.total ?? 0),
			};
		},

		async listUserSessions(userId: string): Promise<AdminUserSessionItem[]> {
			const now = new Date();
			return await database
				.select({
					activeOrganizationId: session.activeOrganizationId,
					createdAt: session.createdAt,
					expiresAt: session.expiresAt,
					id: session.id,
					impersonatedBy: session.impersonatedBy,
					ipAddress: session.ipAddress,
					userAgent: session.userAgent,
				})
				.from(session)
				.where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
				.orderBy(desc(session.createdAt), desc(session.id));
		},

		revokeAllUserSessions: (userId: string) =>
			deleteSessionsAndInvalidate(userId, eq(session.userId, userId)),

		async revokeUserSession(
			userId: string,
			sessionId: string
		): Promise<boolean> {
			const countDeleted = await deleteSessionsAndInvalidate(
				userId,
				and(eq(session.id, sessionId), eq(session.userId, userId)) ??
					eq(session.id, sessionId)
			);
			return countDeleted > 0;
		},

		async unbanUser(userId: string): Promise<AdminUserRecord | null> {
			const [updated] = await database
				.update(user)
				.set({
					banExpires: null,
					banned: false,
					banReason: null,
				})
				.where(eq(user.id, userId))
				.returning(userSelectFields);
			return updated ?? null;
		},

		async withAdminMutationLock<T>(
			fn: (tx: AdminUserMutationTx) => Promise<T>
		): Promise<T> {
			return await database.transaction(async (tx) => {
				await tx.execute(
					sql`SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_ADVISORY_LOCK_KEY})`
				);
				return await fn(createMutationTxAdapter(tx));
			});
		},
	};
}

export type AdminUsersRepository = ReturnType<
	typeof createDrizzleAdminUsersRepository
>;

export const drizzleAdminUsersRepository = createDrizzleAdminUsersRepository();
