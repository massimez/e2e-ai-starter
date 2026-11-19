import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
	invitation,
	member,
	organization,
	user as userTable,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { env } from "../../env";
import { normalizeRoleSlug } from "../../lib/auth/permissions";
import { AppError, isPgErrorCode, NotFoundError } from "../../lib/errors";
import { logError } from "../../lib/logger";
import { scopedWhere } from "../../lib/tenant";
import { enqueueWorkspaceInvitationEmail } from "../email/queue";
import {
	assertAssignableOrganizationRole,
	assertOwner,
} from "./role-permissions";
import type { InviteOrganizationMemberInput } from "./schema";

const INVITATION_EXPIRES_IN_MS = 48 * 60 * 60 * 1000;

async function assertNotExistingMember(organizationId: string, email: string) {
	const existingUser = await db.query.user.findFirst({
		columns: { id: true },
		where: eq(userTable.email, email),
	});

	if (!existingUser) {
		return;
	}

	const existingMember = await db.query.member.findFirst({
		columns: { id: true },
		where: and(
			scopedWhere(member, organizationId),
			eq(member.userId, existingUser.id)
		),
	});

	if (existingMember) {
		throw new AppError(
			"User is already a member of this organization",
			400,
			"USER_ALREADY_MEMBER",
			["email"]
		);
	}
}

async function enqueueInvitationEmail(params: {
	inviterName: string;
	organizationId: string;
	organizationName: string;
	roleSlug: string;
	savedInvitation: typeof invitation.$inferSelect;
}) {
	const {
		inviterName,
		organizationId,
		organizationName,
		roleSlug,
		savedInvitation,
	} = params;

	try {
		await enqueueWorkspaceInvitationEmail({
			corsOrigins: env.CORS_ORIGINS,
			email: savedInvitation.email,
			invitationId: savedInvitation.id,
			inviterName,
			organizationName,
			role: roleSlug,
		});
	} catch (error) {
		logError("Roles:SendInvitationEmail", error, {
			invitationId: savedInvitation.id,
			organizationId,
		});
	}
}

export async function inviteOrganizationMember(
	organizationId: string,
	input: InviteOrganizationMemberInput,
	inviter: { id: string; name: string }
) {
	const roleSlug = normalizeRoleSlug(input.role);
	await assertAssignableOrganizationRole(organizationId, roleSlug);
	if (roleSlug === "admin") {
		await assertOwner(organizationId, inviter.id);
	}

	await assertNotExistingMember(organizationId, input.email);

	const [org] = await db
		.select({ id: organization.id, name: organization.name })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);

	if (!org) {
		throw new NotFoundError("Organization");
	}

	const pendingInvitation = await db.query.invitation.findFirst({
		orderBy: desc(invitation.createdAt),
		where: and(
			scopedWhere(invitation, organizationId),
			eq(invitation.email, input.email),
			eq(invitation.status, "pending")
		),
	});

	if (
		pendingInvitation &&
		normalizeRoleSlug(pendingInvitation.role) === "admin"
	) {
		await assertOwner(organizationId, inviter.id);
	}

	if (
		pendingInvitation &&
		!input.resend &&
		pendingInvitation.expiresAt > new Date()
	) {
		throw new AppError(
			"User is already invited to this organization",
			400,
			"USER_ALREADY_INVITED",
			["email"]
		);
	}

	const expiresAt = new Date(Date.now() + INVITATION_EXPIRES_IN_MS);
	const resent = Boolean(pendingInvitation);
	let savedInvitation: typeof invitation.$inferSelect | undefined;
	try {
		[savedInvitation] = pendingInvitation
			? await db
					.update(invitation)
					.set({ expiresAt, role: roleSlug })
					.where(
						and(
							eq(invitation.id, pendingInvitation.id),
							scopedWhere(invitation, organizationId),
							eq(invitation.status, "pending")
						)
					)
					.returning()
			: await db
					.insert(invitation)
					.values({
						email: input.email,
						expiresAt,
						id: randomUUID(),
						inviterId: inviter.id,
						organizationId,
						role: roleSlug,
						status: "pending",
					})
					.returning();
	} catch (error) {
		if (isPgErrorCode(error, "23505")) {
			throw new AppError("User is already invited to this organization", {
				cause: error,
				code: "USER_ALREADY_INVITED",
				path: ["email"],
				statusCode: 400,
			});
		}
		throw error;
	}

	if (!savedInvitation) {
		throw new AppError(
			pendingInvitation
				? "Invitation is no longer pending"
				: "Failed to save invitation",
			pendingInvitation ? 409 : 500,
			pendingInvitation ? "INVITATION_NOT_PENDING" : "INVITATION_SAVE_FAILED"
		);
	}

	await enqueueInvitationEmail({
		inviterName: inviter.name,
		organizationId,
		organizationName: org.name,
		roleSlug,
		savedInvitation,
	});

	return {
		...savedInvitation,
		resent,
	};
}

export async function cancelOrganizationInvitation(
	organizationId: string,
	invitationId: string
) {
	const existingInvitation = await db.query.invitation.findFirst({
		where: and(
			eq(invitation.id, invitationId),
			scopedWhere(invitation, organizationId)
		),
	});

	if (!existingInvitation) {
		throw new NotFoundError("Invitation");
	}

	if (existingInvitation.status !== "pending") {
		throw new AppError(
			"Only pending invitations can be canceled",
			400,
			"INVITATION_NOT_PENDING",
			["invitationId"]
		);
	}

	const [updated] = await db
		.update(invitation)
		.set({ status: "canceled" })
		.where(
			and(
				eq(invitation.id, invitationId),
				scopedWhere(invitation, organizationId),
				eq(invitation.status, "pending")
			)
		)
		.returning();

	if (!updated) {
		throw new AppError(
			"Only pending invitations can be canceled",
			409,
			"INVITATION_NOT_PENDING",
			["invitationId"]
		);
	}

	return updated;
}
