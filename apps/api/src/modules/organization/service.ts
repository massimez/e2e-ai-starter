import { db } from "@workspace/db";
import { member, organization, session } from "@workspace/db/schema";
import { logError } from "@workspace/shared/logger";
import { parseMemberRoles } from "@workspace/shared/permissions";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { invalidateUserSessionCache } from "../../lib/auth/secondary-storage";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../../lib/errors";
import { scopedWhere } from "../../lib/tenant";
import { cleanupTenantAiMemory } from "../ai/service";
import {
	createDrizzleDefaultOrganizationStore,
	healDefaultOrganizationAfterMembershipLoss,
} from "./default-organization";
import type { UpdateOrganizationInput } from "./schema";

export async function getUserOrganizations(userId: string) {
	return await db
		.select({
			organization,
			role: member.role,
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(eq(member.userId, userId));
}

export async function getOrganizationById(orgId: string) {
	const orgs = await db
		.select()
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);

	return orgs[0] ?? null;
}

export async function transferOwnership(params: {
	currentOwnerUserId: string;
	newOwnerUserId: string;
	organizationId: string;
}) {
	const { currentOwnerUserId, newOwnerUserId, organizationId } = params;

	if (currentOwnerUserId === newOwnerUserId) {
		throw new ValidationError(
			"Target user is already the organization owner",
			"newOwnerUserId"
		);
	}

	return await db.transaction(async (tx) => {
		const orgPredicate = scopedWhere(member, organizationId);

		// Lock both rows in deterministic member.id order to avoid deadlocks
		const lockedMembers = await tx
			.select()
			.from(member)
			.where(
				and(
					orgPredicate,
					inArray(member.userId, [currentOwnerUserId, newOwnerUserId])
				)
			)
			.orderBy(asc(member.id))
			.for("update");

		const currentMember = lockedMembers.find(
			(row) => row.userId === currentOwnerUserId
		);

		if (
			!(currentMember && parseMemberRoles(currentMember.role).includes("owner"))
		) {
			throw new ForbiddenError(
				"Only the organization owner can transfer ownership"
			);
		}

		const targetMember = lockedMembers.find(
			(row) => row.userId === newOwnerUserId
		);

		if (!targetMember) {
			throw new NotFoundError("Target organization member", "newOwnerUserId");
		}

		const targetRoles = parseMemberRoles(targetMember.role);
		if (!targetRoles.includes("admin")) {
			throw new ConflictError(
				"Ownership can only be transferred to an active organization admin",
				"newOwnerUserId"
			);
		}

		const [promoted] = await tx
			.update(member)
			.set({ role: "owner" })
			.where(
				and(
					orgPredicate,
					eq(member.id, targetMember.id),
					eq(member.role, targetMember.role)
				)
			)
			.returning();

		if (!promoted) {
			throw new ConflictError(
				"Target member role changed during ownership transfer",
				"newOwnerUserId"
			);
		}

		const [demoted] = await tx
			.update(member)
			.set({ role: "admin" })
			.where(
				and(
					orgPredicate,
					eq(member.id, currentMember.id),
					eq(member.role, currentMember.role)
				)
			)
			.returning();

		if (!demoted) {
			throw new ConflictError(
				"Current owner role changed during ownership transfer"
			);
		}

		return {
			newOwnerUserId: promoted.userId,
			organizationId,
			previousOwnerUserId: currentOwnerUserId,
		};
	});
}

export async function updateCurrentOrganization(
	organizationId: string,
	input: UpdateOrganizationInput
) {
	const existing = await getOrganizationById(organizationId);
	if (!existing) {
		throw new NotFoundError("Organization");
	}

	if (input.slug !== undefined && input.slug !== existing.slug) {
		const [slugConflict] = await db
			.select({ id: organization.id })
			.from(organization)
			.where(
				and(
					eq(organization.slug, input.slug),
					ne(organization.id, organizationId)
				)
			)
			.limit(1);

		if (slugConflict) {
			throw new ConflictError("Organization slug already taken", "slug");
		}
	}

	const updates: Partial<typeof organization.$inferInsert> = {};
	if (input.name !== undefined) {
		updates.name = input.name;
	}
	if (input.slug !== undefined) {
		updates.slug = input.slug;
	}
	if (input.logo !== undefined) {
		updates.logo = input.logo === "" ? null : input.logo;
	}
	if (input.metadata !== undefined) {
		updates.metadata = JSON.stringify(input.metadata);
	}

	const [updated] = await db
		.update(organization)
		.set(updates)
		.where(eq(organization.id, organizationId))
		.returning();

	if (!updated) {
		throw new NotFoundError("Organization");
	}

	return updated;
}

export async function removeOrganizationMember(params: {
	actorUserId: string;
	memberId: string;
	organizationId: string;
}) {
	const { actorUserId, memberId, organizationId } = params;
	const orgPredicate = scopedWhere(member, organizationId);

	const { sessionTokens, targetMember } = await db.transaction(async (tx) => {
		const [lockedMember] = await tx
			.select()
			.from(member)
			.where(and(orgPredicate, eq(member.id, memberId)))
			.for("update")
			.limit(1);

		if (!lockedMember) {
			throw new NotFoundError("Organization member", "memberId");
		}

		if (parseMemberRoles(lockedMember.role).includes("owner")) {
			throw new ForbiddenError(
				"Organization owner cannot be removed; transfer ownership first"
			);
		}

		if (lockedMember.userId === actorUserId) {
			throw new ValidationError(
				"Use Leave Organization to remove yourself from the workspace",
				"memberId"
			);
		}

		const [deletedMember] = await tx
			.delete(member)
			.where(
				and(
					orgPredicate,
					eq(member.id, lockedMember.id),
					eq(member.role, lockedMember.role)
				)
			)
			.returning();

		if (!deletedMember) {
			throw new ConflictError(
				"Organization member was modified concurrently",
				"memberId"
			);
		}

		const txDefaultOrgStore = createDrizzleDefaultOrganizationStore(
			tx as unknown as typeof db
		);
		const fallbackOrganizationId =
			await healDefaultOrganizationAfterMembershipLoss(
				{
					lostOrganizationId: organizationId,
					userId: lockedMember.userId,
				},
				txDefaultOrgStore
			);

		const updatedSessions = await tx
			.update(session)
			.set({ activeOrganizationId: fallbackOrganizationId })
			.where(
				and(
					eq(session.userId, lockedMember.userId),
					eq(session.activeOrganizationId, organizationId)
				)
			)
			.returning({ token: session.token });

		return {
			sessionTokens: updatedSessions.map((row) => row.token),
			targetMember: deletedMember,
		};
	});

	await invalidateUserSessionCache(targetMember.userId, sessionTokens);

	try {
		await cleanupTenantAiMemory(organizationId, [targetMember.userId]);
	} catch (error) {
		logError("OrganizationService:removeMemberAiCleanup", error, {
			organizationId,
			userId: targetMember.userId,
		});
	}

	return {
		member: targetMember,
	};
}
