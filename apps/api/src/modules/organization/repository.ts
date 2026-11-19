import { db } from "@workspace/db";
import { member, organization, session } from "@workspace/db/schema";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { scopedWhere } from "../../lib/tenant";
import { createDrizzleDefaultOrganizationStore } from "./default-organization";

export type OrganizationInsert = typeof organization.$inferInsert;

function createDrizzleOrganizationTxRepository(tx: typeof db) {
	return {
		async clearActiveOrganizationOnSessions(
			userId: string,
			organizationId: string,
			fallbackOrganizationId: string | null
		): Promise<string[]> {
			const updatedSessions = await tx
				.update(session)
				.set({ activeOrganizationId: fallbackOrganizationId })
				.where(
					and(
						eq(session.userId, userId),
						eq(session.activeOrganizationId, organizationId)
					)
				)
				.returning({ token: session.token });

			return updatedSessions.map((row) => row.token);
		},

		defaultOrgStore: createDrizzleDefaultOrganizationStore(tx),

		async deleteMemberWithRoleCheck(
			organizationId: string,
			memberId: string,
			expectedRole: string
		) {
			const [deleted] = await tx
				.delete(member)
				.where(
					and(
						scopedWhere(member, organizationId),
						eq(member.id, memberId),
						eq(member.role, expectedRole)
					)
				)
				.returning();
			return deleted ?? null;
		},

		async findLockedMemberById(organizationId: string, memberId: string) {
			const [lockedMember] = await tx
				.select()
				.from(member)
				.where(
					and(scopedWhere(member, organizationId), eq(member.id, memberId))
				)
				.for("update")
				.limit(1);
			return lockedMember ?? null;
		},

		async findLockedMembersByUserIds(
			organizationId: string,
			userIds: string[]
		) {
			// Lock rows in deterministic member.id order to avoid deadlocks
			return await tx
				.select()
				.from(member)
				.where(
					and(
						scopedWhere(member, organizationId),
						inArray(member.userId, userIds)
					)
				)
				.orderBy(asc(member.id))
				.for("update");
		},

		async updateMemberRoleWithCheck(
			organizationId: string,
			memberId: string,
			expectedRole: string,
			nextRole: string
		) {
			const [updated] = await tx
				.update(member)
				.set({ role: nextRole })
				.where(
					and(
						scopedWhere(member, organizationId),
						eq(member.id, memberId),
						eq(member.role, expectedRole)
					)
				)
				.returning();
			return updated ?? null;
		},
	};
}

export type OrganizationTxRepository = ReturnType<
	typeof createDrizzleOrganizationTxRepository
>;

/**
 * Builds the Drizzle-backed repository for organization and membership persistence.
 */
export function createDrizzleOrganizationRepository(database = db) {
	return {
		async existsBySlugExcludingId(
			slug: string,
			excludeOrgId: string
		): Promise<boolean> {
			const [conflict] = await database
				.select({ id: organization.id })
				.from(organization)
				.where(
					and(eq(organization.slug, slug), ne(organization.id, excludeOrgId))
				)
				.limit(1);
			return Boolean(conflict);
		},

		async findById(orgId: string) {
			const orgs = await database
				.select()
				.from(organization)
				.where(eq(organization.id, orgId))
				.limit(1);
			return orgs[0] ?? null;
		},

		async findUserOrganizations(userId: string) {
			return await database
				.select({
					organization,
					role: member.role,
				})
				.from(member)
				.innerJoin(organization, eq(member.organizationId, organization.id))
				.where(eq(member.userId, userId));
		},

		async transaction<T>(
			fn: (txRepo: OrganizationTxRepository) => Promise<T>
		): Promise<T> {
			return await database.transaction(
				async (tx) =>
					await fn(
						createDrizzleOrganizationTxRepository(tx as unknown as typeof db)
					)
			);
		},

		async updateById(
			organizationId: string,
			updates: Partial<OrganizationInsert>
		) {
			const [updated] = await database
				.update(organization)
				.set(updates)
				.where(eq(organization.id, organizationId))
				.returning();
			return updated ?? null;
		},
	};
}

export type OrganizationRepository = ReturnType<
	typeof createDrizzleOrganizationRepository
>;

export const drizzleOrganizationRepository =
	createDrizzleOrganizationRepository();
