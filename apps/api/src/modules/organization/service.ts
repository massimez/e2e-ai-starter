import { logError } from "@workspace/shared/logger";
import { parseMemberRoles } from "@workspace/shared/permissions";
import { invalidateUserSessionCache } from "../../lib/auth/secondary-storage";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../../lib/errors";
import { cleanupTenantAiMemory } from "../ai/service";
import { healDefaultOrganizationAfterMembershipLoss } from "./default-organization";
import {
	drizzleOrganizationRepository,
	type OrganizationInsert,
	type OrganizationRepository,
} from "./repository";
import type { UpdateOrganizationInput } from "./schema";

function buildOrganizationUpdates(
	input: UpdateOrganizationInput
): Partial<OrganizationInsert> {
	const updates: Partial<OrganizationInsert> = {};
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
	return updates;
}

/**
 * Builds the organization domain service backed by the given repository.
 */
export function createOrganizationService(
	repository: OrganizationRepository = drizzleOrganizationRepository
) {
	return {
		async getOrganizationById(orgId: string) {
			return await repository.findById(orgId);
		},

		async getUserOrganizations(userId: string) {
			return await repository.findUserOrganizations(userId);
		},

		async removeOrganizationMember(params: {
			actorUserId: string;
			memberId: string;
			organizationId: string;
		}) {
			const { actorUserId, memberId, organizationId } = params;

			const { sessionTokens, targetMember } = await repository.transaction(
				async (tx) => {
					const lockedMember = await tx.findLockedMemberById(
						organizationId,
						memberId
					);

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

					const deletedMember = await tx.deleteMemberWithRoleCheck(
						organizationId,
						lockedMember.id,
						lockedMember.role
					);

					if (!deletedMember) {
						throw new ConflictError(
							"Organization member was modified concurrently",
							"memberId"
						);
					}

					const fallbackOrganizationId =
						await healDefaultOrganizationAfterMembershipLoss(
							{
								lostOrganizationId: organizationId,
								userId: lockedMember.userId,
							},
							tx.defaultOrgStore
						);

					const tokens = await tx.clearActiveOrganizationOnSessions(
						lockedMember.userId,
						organizationId,
						fallbackOrganizationId
					);

					return {
						sessionTokens: tokens,
						targetMember: deletedMember,
					};
				}
			);

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
		},

		async transferOwnership(params: {
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

			return await repository.transaction(async (tx) => {
				const lockedMembers = await tx.findLockedMembersByUserIds(
					organizationId,
					[currentOwnerUserId, newOwnerUserId]
				);

				const currentMember = lockedMembers.find(
					(row) => row.userId === currentOwnerUserId
				);

				if (
					!(
						currentMember &&
						parseMemberRoles(currentMember.role).includes("owner")
					)
				) {
					throw new ForbiddenError(
						"Only the organization owner can transfer ownership"
					);
				}

				const targetMember = lockedMembers.find(
					(row) => row.userId === newOwnerUserId
				);

				if (!targetMember) {
					throw new NotFoundError(
						"Target organization member",
						"newOwnerUserId"
					);
				}

				const targetRoles = parseMemberRoles(targetMember.role);
				if (!targetRoles.includes("admin")) {
					throw new ConflictError(
						"Ownership can only be transferred to an active organization admin",
						"newOwnerUserId"
					);
				}

				const promoted = await tx.updateMemberRoleWithCheck(
					organizationId,
					targetMember.id,
					targetMember.role,
					"owner"
				);

				if (!promoted) {
					throw new ConflictError(
						"Target member role changed during ownership transfer",
						"newOwnerUserId"
					);
				}

				const demoted = await tx.updateMemberRoleWithCheck(
					organizationId,
					currentMember.id,
					currentMember.role,
					"admin"
				);

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
		},

		async updateCurrentOrganization(
			organizationId: string,
			input: UpdateOrganizationInput
		) {
			const existing = await repository.findById(organizationId);
			if (!existing) {
				throw new NotFoundError("Organization");
			}

			if (input.slug !== undefined && input.slug !== existing.slug) {
				const slugConflict = await repository.existsBySlugExcludingId(
					input.slug,
					organizationId
				);
				if (slugConflict) {
					throw new ConflictError("Organization slug already taken", "slug");
				}
			}

			const updated = await repository.updateById(
				organizationId,
				buildOrganizationUpdates(input)
			);
			if (!updated) {
				throw new NotFoundError("Organization");
			}

			return updated;
		},
	};
}

export const organizationService = createOrganizationService();

export const {
	getOrganizationById,
	getUserOrganizations,
	removeOrganizationMember,
	transferOwnership,
	updateCurrentOrganization,
} = organizationService;
