import { db } from "@workspace/db";
import { member, organization } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { parseMemberRoles } from "../../lib/auth/permissions";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../../lib/errors";
import { scopedWhere } from "../../lib/tenant";

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
