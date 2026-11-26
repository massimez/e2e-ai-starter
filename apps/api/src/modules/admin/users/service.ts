import { isPlatformAdminRole } from "@workspace/shared/permissions";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../../../lib/errors";
import { isActiveUserBan } from "../../../middleware/auth";
import { buildPaginationMeta } from "../shared";
import {
	type AdminUsersRepository,
	drizzleAdminUsersRepository,
} from "./repository";
import type {
	BanUserBody,
	ListAdminUsersQuery,
	UpdateUserRoleBody,
} from "./schema";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function createAdminUsersService(
	repository: AdminUsersRepository = drizzleAdminUsersRepository
) {
	return {
		async banUser(params: {
			actorId: string;
			body: BanUserBody;
			userId: string;
		}) {
			if (params.userId === params.actorId) {
				throw new ValidationError("You cannot ban your own account.");
			}

			const banExpires = params.body.expiresInDays
				? new Date(Date.now() + params.body.expiresInDays * MS_PER_DAY)
				: null;

			const outcome = await repository.withAdminMutationLock(async (tx) => {
				const target = await tx.findUserById(params.userId);
				if (!target) {
					throw new NotFoundError("User");
				}
				if (isPlatformAdminRole(target.role)) {
					throw new ForbiddenError(
						"Cannot ban a platform administrator. Demote their platform role first."
					);
				}

				const result = await tx.banUser({
					banExpires,
					banReason: params.body.reason,
					userId: params.userId,
				});
				if (!result) {
					throw new NotFoundError("User");
				}
				return result;
			});

			await repository.invalidateUserSessionsCache(
				params.userId,
				outcome.revokedTokens
			);
			return outcome.updated;
		},

		async getUserDetail(userId: string) {
			const target = await repository.findUserById(userId);
			if (!target) {
				throw new NotFoundError("User");
			}
			const [memberships, sessions] = await Promise.all([
				repository.listUserMemberships(userId),
				repository.listUserSessions(userId),
			]);
			return {
				memberships,
				sessions,
				user: {
					...target,
					banned: isActiveUserBan(target),
					twoFactorEnabled: Boolean(target.twoFactorEnabled),
				},
			};
		},

		async listUsers(query: ListAdminUsersQuery) {
			const { page, ...filterParams } = query;
			const offset = (page - 1) * query.limit;

			const { items, total } = await repository.listUsers({
				...filterParams,
				offset,
			});

			return {
				items,
				pagination: buildPaginationMeta({
					itemCount: items.length,
					limit: query.limit,
					offset,
					page,
					total,
				}),
			};
		},

		async revokeAllUserSessions(params: { actorId: string; userId: string }) {
			if (params.userId === params.actorId) {
				throw new ValidationError(
					"Use account security settings to revoke your own sessions."
				);
			}
			const target = await repository.findUserById(params.userId);
			if (!target) {
				throw new NotFoundError("User");
			}
			const revokedCount = await repository.revokeAllUserSessions(
				params.userId
			);
			return { revokedCount, userId: params.userId };
		},

		async revokeUserSession(params: {
			actorId: string;
			currentSessionId?: string | null;
			sessionId: string;
			userId: string;
		}) {
			if (
				params.userId === params.actorId &&
				params.currentSessionId === params.sessionId
			) {
				throw new ValidationError(
					"Use account security settings to sign out of your current session."
				);
			}
			const revoked = await repository.revokeUserSession(
				params.userId,
				params.sessionId
			);
			if (!revoked) {
				throw new NotFoundError("Session");
			}
			return { revoked: true, sessionId: params.sessionId };
		},

		async unbanUser(userId: string) {
			const updated = await repository.unbanUser(userId);
			if (!updated) {
				throw new NotFoundError("User");
			}
			return updated;
		},

		async updateUserRole(params: {
			actorId: string;
			body: UpdateUserRoleBody;
			userId: string;
		}) {
			if (params.userId === params.actorId) {
				throw new ValidationError("You cannot modify your own platform role.");
			}

			const outcome = await repository.withAdminMutationLock(async (tx) => {
				const target = await tx.findUserById(params.userId);
				if (!target) {
					throw new NotFoundError("User");
				}

				if (params.body.role === "admin" && isActiveUserBan(target)) {
					throw new ConflictError(
						"Cannot promote a banned user to platform administrator. Unban the user first."
					);
				}

				const isCurrentlyAdmin = isPlatformAdminRole(target.role);
				if (isCurrentlyAdmin && params.body.role !== "admin") {
					const activeAdminCount = await tx.countActivePlatformAdmins();
					if (activeAdminCount <= 1) {
						throw new ConflictError(
							"Cannot demote the last remaining active platform administrator."
						);
					}
				}

				const result = await tx.updateUserRole(params.userId, params.body.role);
				if (!result) {
					throw new NotFoundError("User");
				}
				return {
					activeTokens: result.activeTokens,
					previousRole: target.role,
					updated: result.updated,
				};
			});

			await repository.invalidateUserSessionsCache(
				params.userId,
				outcome.activeTokens
			);
			return {
				previousRole: outcome.previousRole,
				user: outcome.updated,
			};
		},
	};
}

export const adminUsersService = createAdminUsersService();
