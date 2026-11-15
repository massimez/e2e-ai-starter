import { db } from "@workspace/db";
import { member, organization, session } from "@workspace/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { parseMemberRoles } from "../../lib/auth/permissions";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../../lib/errors";
import { scopedWhere } from "../../lib/tenant";
import { healDefaultOrganizationAfterMembershipLoss } from "./default-organization";
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

		const [currentMember] = await tx
			.select()
			.from(member)
			.where(and(orgPredicate, eq(member.userId, currentOwnerUserId)))
			.limit(1);

		if (
			!(currentMember && parseMemberRoles(currentMember.role).includes("owner"))
		) {
			throw new ForbiddenError(
				"Only the organization owner can transfer ownership"
			);
		}

		const [targetMember] = await tx
			.select()
			.from(member)
			.where(and(orgPredicate, eq(member.userId, newOwnerUserId)))
			.limit(1);

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
			.where(eq(member.id, targetMember.id))
			.returning();

		await tx
			.update(member)
			.set({ role: "admin" })
			.where(eq(member.id, currentMember.id));

		return {
			newOwnerUserId: promoted?.userId ?? newOwnerUserId,
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

	const [targetMember] = await db
		.select()
		.from(member)
		.where(and(orgPredicate, eq(member.id, memberId)))
		.limit(1);

	if (!targetMember) {
		throw new NotFoundError("Organization member", "memberId");
	}

	if (parseMemberRoles(targetMember.role).includes("owner")) {
		throw new ForbiddenError(
			"Organization owner cannot be removed; transfer ownership first"
		);
	}

	if (targetMember.userId === actorUserId) {
		throw new ValidationError(
			"Use Leave Organization to remove yourself from the workspace",
			"memberId"
		);
	}

	await db
		.delete(member)
		.where(and(orgPredicate, eq(member.id, targetMember.id)));

	const fallbackOrganizationId =
		await healDefaultOrganizationAfterMembershipLoss({
			lostOrganizationId: organizationId,
			userId: targetMember.userId,
		});

	await db
		.update(session)
		.set({ activeOrganizationId: fallbackOrganizationId })
		.where(
			and(
				eq(session.userId, targetMember.userId),
				eq(session.activeOrganizationId, organizationId)
			)
		);

	return {
		member: targetMember,
	};
}
