import { logError } from "@workspace/shared/logger";
import {
	createAuthMiddleware,
	getSessionFromCtx,
	isAPIError,
} from "better-auth/api";
import {
	type DefaultOrganizationStore,
	enforceActiveOnOrganizationCreateBody,
	healDefaultOrganizationAfterMembershipLoss,
	persistDefaultOrganizationOnCreate,
	resolveSessionOrganizationOnConnect,
	syncDefaultOrganizationOnSessionActivation,
} from "../../modules/organization/default-organization";

interface HookSession {
	session: {
		activeOrganizationId?: string | null;
		token: string;
	};
	user: {
		id: string;
	};
}

interface LeaveOrDeleteBody {
	organizationId?: string;
}

interface RemovedMemberPayload {
	member?: {
		organizationId?: string;
		userId?: string;
	};
}

async function reactivateFallbackOnActingSession(params: {
	activeOrganizationId: string | null | undefined;
	fallbackOrganizationId: string | null;
	internalAdapter?: {
		updateSession: (
			sessionToken: string,
			data: Record<string, unknown>
		) => Promise<unknown>;
	};
	lostOrganizationId: string;
	sessionToken: string;
}): Promise<void> {
	if (
		!(
			params.fallbackOrganizationId &&
			params.internalAdapter &&
			params.activeOrganizationId === params.lostOrganizationId
		)
	) {
		return;
	}

	await params.internalAdapter.updateSession(params.sessionToken, {
		activeOrganizationId: params.fallbackOrganizationId,
	});
}

function extractLostOrganizationId(
	ctxPath: string | undefined,
	body: unknown,
	returned: unknown
): string | null {
	if (ctxPath === "/organization/remove-member") {
		const payload = returned as RemovedMemberPayload | undefined;
		return payload?.member?.organizationId?.trim() || null;
	}

	if (ctxPath === "/organization/delete") {
		const deleted = returned as { id?: string } | undefined;
		if (typeof deleted?.id === "string" && deleted.id.trim().length > 0) {
			return deleted.id.trim();
		}
	}

	const rawOrgId = (body as LeaveOrDeleteBody | undefined)?.organizationId;
	return typeof rawOrgId === "string" && rawOrgId.trim().length > 0
		? rawOrgId.trim()
		: null;
}

const MEMBERSHIP_LOSS_PATHS = new Set([
	"/organization/delete",
	"/organization/leave",
	"/organization/remove-member",
]);

const ORG_ACTIVATION_PATHS = new Set([
	"/organization/accept-invitation",
	"/organization/set-active",
]);

export interface OrganizationLifecycleOptions {
	onBeforeOrganizationDelete?: (organizationId: string) => Promise<void>;
	onMembershipLost?: (params: {
		organizationId: string;
		userId: string;
	}) => Promise<void>;
	onOrganizationCreated?: (organizationId: string) => Promise<void>;
}

/**
 * Builds Better Auth middleware, database hooks, and organization plugin hooks
 * that enforce active-on-create and persisted default organization across logins and switches.
 */
export function createOrganizationLifecycleHooks(
	store?: DefaultOrganizationStore,
	options?: OrganizationLifecycleOptions
) {
	const before = createAuthMiddleware(async (ctx) => {
		if (ctx.path === "/organization/create") {
			const updatedBody = enforceActiveOnOrganizationCreateBody(ctx.body);
			if (!updatedBody) {
				return;
			}

			return {
				context: {
					body: updatedBody,
				},
			};
		}

		// Capture pre-mutation session (including pre-cleared activeOrganizationId)
		// so hooks.after knows both the acting user and whether the lost org was active.
		if (MEMBERSHIP_LOSS_PATHS.has(ctx.path)) {
			await getSessionFromCtx(ctx).catch(() => null);
		}
	});

	async function applyMembershipLossEffects(params: {
		actingSession: HookSession;
		internalAdapter?: {
			updateSession: (
				sessionToken: string,
				data: Record<string, unknown>
			) => Promise<unknown>;
		};
		lostOrganizationId: string;
		path: string;
	}) {
		const { actingSession, internalAdapter, lostOrganizationId, path } = params;
		const fallbackOrganizationId =
			await healDefaultOrganizationAfterMembershipLoss(
				{
					lostOrganizationId,
					userId: actingSession.user.id,
				},
				store
			);

		await reactivateFallbackOnActingSession({
			activeOrganizationId: actingSession.session.activeOrganizationId,
			fallbackOrganizationId,
			internalAdapter,
			lostOrganizationId,
			sessionToken: actingSession.session.token,
		});

		if (path === "/organization/leave" && options?.onMembershipLost) {
			await options.onMembershipLost({
				organizationId: lostOrganizationId,
				userId: actingSession.user.id,
			});
		}
	}

	const after = createAuthMiddleware(async (ctx) => {
		if (!MEMBERSHIP_LOSS_PATHS.has(ctx.path)) {
			return;
		}

		const { returned } = ctx.context;
		if (returned === undefined || isAPIError(returned)) {
			return;
		}

		const actingSession = (ctx.context.session ??
			(await getSessionFromCtx(ctx).catch(() => null))) as
			| HookSession
			| null
			| undefined;
		if (!actingSession?.user?.id) {
			return;
		}

		const lostOrganizationId = extractLostOrganizationId(
			ctx.path,
			ctx.body,
			returned
		);
		if (!lostOrganizationId) {
			return;
		}

		if (ctx.path === "/organization/remove-member") {
			const removedUserId = (returned as RemovedMemberPayload | undefined)
				?.member?.userId;
			if (!removedUserId || removedUserId !== actingSession.user.id) {
				return;
			}
		}

		try {
			await applyMembershipLossEffects({
				actingSession,
				internalAdapter: ctx.context.internalAdapter,
				lostOrganizationId,
				path: ctx.path,
			});
		} catch (error) {
			logError("AuthOrganizationLifecycle:afterHook", error, {
				lostOrganizationId,
				path: ctx.path,
				userId: actingSession.user.id,
			});
		}
	});

	const sessionDatabaseHooks = {
		create: {
			before: async (session: {
				activeOrganizationId?: string | null;
				userId: string;
			}) => {
				try {
					const resolvedOrganizationId =
						await resolveSessionOrganizationOnConnect(
							{
								requestedOrganizationId: session.activeOrganizationId,
								userId: session.userId,
							},
							store
						);

					if (resolvedOrganizationId === session.activeOrganizationId) {
						return;
					}

					return {
						data: {
							...session,
							activeOrganizationId: resolvedOrganizationId,
						},
					};
				} catch (error) {
					logError("AuthSessionDefaultOrg:resolve", error, {
						userId: session.userId,
					});
					throw error;
				}
			},
		},
		update: {
			after: async (
				session: {
					activeOrganizationId?: string | null;
					userId: string;
				} | null,
				context?: { path?: string } | null
			) => {
				if (
					!session?.userId ||
					(context?.path && !ORG_ACTIVATION_PATHS.has(context.path))
				) {
					return;
				}

				try {
					await syncDefaultOrganizationOnSessionActivation(
						{
							activeOrganizationId: session.activeOrganizationId,
							userId: session.userId,
						},
						store
					);
				} catch (error) {
					logError("AuthSessionDefaultOrg:sync", error, {
						activeOrganizationId: session.activeOrganizationId,
						userId: session.userId,
					});
				}
			},
		},
	};

	const organizationHooks = {
		afterCreateOrganization: async ({
			organization,
			user,
		}: {
			organization: { id: string };
			user: { id: string };
		}) => {
			await persistDefaultOrganizationOnCreate(
				{
					organizationId: organization.id,
					userId: user.id,
				},
				store
			);
			if (options?.onOrganizationCreated) {
				try {
					await options.onOrganizationCreated(organization.id);
				} catch (error) {
					logError("AuthOrganizationLifecycle:onOrganizationCreated", error, {
						organizationId: organization.id,
						userId: user.id,
					});
				}
			}
		},
		// Delete & leave are healed once in `hooks.after` (which also restores any fallback active org);
		// `afterRemoveMember` remains here so admin-initiated removal heals another member's default.
		afterRemoveMember: async ({
			organization,
			user,
		}: {
			organization: { id: string };
			user: { id: string };
		}) => {
			try {
				await healDefaultOrganizationAfterMembershipLoss(
					{
						lostOrganizationId: organization.id,
						userId: user.id,
					},
					store
				);
			} catch (error) {
				logError("AuthOrganizationLifecycle:afterRemoveMember", error, {
					organizationId: organization.id,
					userId: user.id,
				});
			}
			if (options?.onMembershipLost) {
				try {
					await options.onMembershipLost({
						organizationId: organization.id,
						userId: user.id,
					});
				} catch (error) {
					logError(
						"AuthOrganizationLifecycle:removeMemberMemoryCleanup",
						error,
						{
							organizationId: organization.id,
							userId: user.id,
						}
					);
				}
			}
		},
		beforeDeleteOrganization: async ({
			organization,
		}: {
			organization: { id: string };
		}) => {
			if (!options?.onBeforeOrganizationDelete) {
				return;
			}
			try {
				await options.onBeforeOrganizationDelete(organization.id);
			} catch (error) {
				logError("AuthOrganizationLifecycle:beforeDeleteOrganization", error, {
					organizationId: organization.id,
				});
			}
		},
	};

	return {
		after,
		before,
		organizationHooks,
		sessionDatabaseHooks,
	};
}
