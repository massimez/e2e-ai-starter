"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type EffectiveOrganizationPermissions,
	getStaticRolePermissions,
	isOrgAdminRole,
	normalizeRoleSlug,
	type OrganizationPermissionGroup,
	type OrganizationRoleName,
	type OrganizationRoleSummary,
	PERMISSION_CATALOG_ENTRIES,
	parseMemberRoles,
	SYSTEM_ROLE_META,
	SYSTEM_ROLE_SLUGS,
} from "@workspace/shared/permissions";
import { toast } from "sonner";
import { client, parseApiResponse } from "./api-client";
import { authClient } from "./auth-client";

export interface OrganizationMember {
	createdAt: string | Date;
	id: string;
	role: string;
	user: {
		email: string;
		id: string;
		image?: string | null;
		name: string;
	};
	userId: string;
}

export interface OrganizationInvitation {
	createdAt?: string | Date;
	email: string;
	expiresAt: string | Date;
	id: string;
	inviterId?: string;
	role: string;
	status: string;
}

export interface FullOrganization {
	createdAt: string | Date;
	id: string;
	invitations: OrganizationInvitation[];
	logo?: string | null;
	members: OrganizationMember[];
	metadata?: Record<string, unknown> | null;
	name: string;
	slug: string;
}

interface DynamicRoleRecord {
	createdAt?: Date | string;
	id: string;
	organizationId: string;
	permission: Record<string, string[]>;
	role: string;
	updatedAt?: Date | string;
}

export const organizationKeys = {
	all: ["organizations"] as const,
	detail: (organizationId: string) =>
		[...organizationKeys.all, "detail", organizationId] as const,
	myPermissions: (organizationId: string, roleKey: string) =>
		[...organizationKeys.all, "roles", organizationId, "me", roleKey] as const,
	roles: (organizationId: string) =>
		[...organizationKeys.all, "roles", organizationId] as const,
};

function orgHeadersInit(organizationId?: string) {
	return organizationId
		? { init: { headers: { "x-organization-id": organizationId } } }
		: undefined;
}

const ROLE_SLUG_SEPARATOR_REGEX = /[-_]+/u;

function formatCustomRoleName(slug: string): string {
	return slug
		.split(ROLE_SLUG_SEPARATOR_REGEX)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function permissionMapToKeys(
	map: Record<string, readonly string[] | undefined> | null | undefined
): string[] {
	if (!map) {
		return [];
	}
	const keys: string[] = [];
	for (const [resource, actions] of Object.entries(map)) {
		if (!actions) {
			continue;
		}
		for (const action of actions) {
			keys.push(`${resource}:${action}`);
		}
	}
	return keys;
}

function permissionKeysToMap(
	keys: readonly string[]
): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const key of keys) {
		const [resource, action] = key.split(":");
		if (!(resource && action)) {
			continue;
		}
		const existing = result[resource] ?? [];
		if (!existing.includes(action)) {
			result[resource] = [...existing, action];
		}
	}
	return result;
}

function getSystemRolesList(): OrganizationRoleSummary[] {
	return SYSTEM_ROLE_SLUGS.map((slug: OrganizationRoleName) => ({
		description: SYSTEM_ROLE_META[slug].description,
		id: `system:${slug}`,
		isDefault: slug === "member",
		isSystem: true,
		name: SYSTEM_ROLE_META[slug].name,
		permissions: getStaticRolePermissions(slug),
		slug,
	}));
}

function mapDynamicRoleToSummary(
	record: DynamicRoleRecord
): OrganizationRoleSummary {
	return {
		description: null,
		id: record.id,
		isDefault: false,
		isSystem: false,
		name: formatCustomRoleName(record.role),
		permissions: permissionMapToKeys(record.permission),
		slug: record.role,
	};
}

const STATIC_PERMISSION_GROUPS: OrganizationPermissionGroup[] =
	PERMISSION_CATALOG_ENTRIES.map((entry) => ({
		permissions: entry.actions.map((action) => ({
			action,
			key: `${entry.resource}:${action}`,
			resource: entry.resource,
		})),
		resource: entry.resource,
	}));

const SYSTEM_ROLE_SET = new Set<string>(SYSTEM_ROLE_SLUGS);

async function resolveCustomRolePermissions(
	organizationId: string,
	roleSlug: string
): Promise<string[]> {
	const roleResult = await authClient.organization.getRole({
		query: { organizationId, roleName: roleSlug },
	});
	if (!roleResult.error && roleResult.data) {
		const record = roleResult.data as unknown as DynamicRoleRecord;
		return permissionMapToKeys(record.permission);
	}

	const checks = await Promise.all(
		PERMISSION_CATALOG_ENTRIES.flatMap((entry) =>
			entry.actions.map(async (action) => {
				const res = await authClient.organization.hasPermission({
					organizationId,
					permissions: { [entry.resource]: [action] } as never,
				});
				return res.data?.success ? `${entry.resource}:${action}` : null;
			})
		)
	);
	return checks.filter((key): key is string => key !== null);
}

export function useMyOrganizationPermissions(
	organizationId?: string,
	memberRole?: string | null
) {
	const roleSlug = normalizeRoleSlug(memberRole);
	const memberRoles = parseMemberRoles(memberRole).map((role) =>
		role.trim().toLowerCase()
	);

	return useQuery<EffectiveOrganizationPermissions | null>({
		enabled: Boolean(organizationId && memberRole),
		queryFn: async () => {
			if (!(organizationId && memberRole)) {
				return null;
			}
			const isOwner = memberRoles.includes("owner");
			const permissionSet = new Set<string>();

			await Promise.all(
				memberRoles.map(async (slug) => {
					const perms = SYSTEM_ROLE_SET.has(slug)
						? getStaticRolePermissions(slug)
						: await resolveCustomRolePermissions(organizationId, slug);
					for (const perm of perms) {
						permissionSet.add(perm);
					}
				})
			);

			return {
				isOwner,
				permissions: Array.from(permissionSet),
				roleSlug,
			};
		},
		queryKey: organizationKeys.myPermissions(
			organizationId ?? "none",
			memberRole ?? "none"
		),
		staleTime: 30_000,
	});
}

export function useOrganizationRoles(organizationId?: string) {
	return useQuery<OrganizationRoleSummary[]>({
		enabled: Boolean(organizationId),
		queryFn: async () => {
			const systemRoles = getSystemRolesList();
			if (!organizationId) {
				return systemRoles;
			}

			const res = await authClient.organization.listRoles({
				query: { organizationId },
			});
			if (res.error || !Array.isArray(res.data)) {
				return systemRoles;
			}

			const customRoles = (res.data as unknown as DynamicRoleRecord[]).map(
				mapDynamicRoleToSummary
			);
			return [...systemRoles, ...customRoles];
		},
		queryKey: organizationKeys.roles(organizationId ?? "none"),
		staleTime: 30_000,
	});
}

export function useOrganizationPermissionsCatalog(
	_organizationId?: string,
	_enabled = true
) {
	return {
		data: STATIC_PERMISSION_GROUPS,
		isPending: false,
	};
}

export function useCurrentOrganization() {
	const session = authClient.useSession();
	const activeOrg = authClient.useActiveOrganization();
	const listOrgs = authClient.useListOrganizations();

	const activeOrgId = activeOrg.data?.id;

	const fullOrgQuery = useQuery<FullOrganization | null>({
		enabled: Boolean(activeOrgId),
		queryFn: async () => {
			if (!activeOrgId) {
				return null;
			}
			const res = await authClient.organization.getFullOrganization({
				query: { organizationId: activeOrgId },
			});
			if (res.error) {
				throw new Error(
					res.error.message || "Failed to load organization details"
				);
			}
			return res.data ? (res.data as unknown as FullOrganization) : null;
		},
		queryKey: organizationKeys.detail(activeOrgId ?? "none"),
		staleTime: 30_000,
	});

	const fullOrg = fullOrgQuery.data ?? null;
	const currentUserId = session.data?.user.id;
	const currentMember = fullOrg?.members.find(
		(m) => m.userId === currentUserId
	);
	const currentUserRole: string | null = currentMember?.role ?? null;
	const memberRoles = parseMemberRoles(currentUserRole);

	const myPermissionsQuery = useMyOrganizationPermissions(
		activeOrgId,
		currentUserRole
	);
	const effectivePermissions = myPermissionsQuery.data ?? null;

	const isOwner =
		memberRoles.includes("owner") || Boolean(effectivePermissions?.isOwner);
	const isAdmin = isOrgAdminRole(currentUserRole);

	const hasPermission = (permission: string): boolean => {
		if (isOwner) {
			return true;
		}
		return effectivePermissions?.permissions.includes(permission) ?? false;
	};

	const canManageMembers = effectivePermissions
		? hasPermission("member:invite") ||
			hasPermission("member:remove") ||
			hasPermission("member:delete")
		: isAdmin;
	const canManageSettings = effectivePermissions
		? hasPermission("organization:update") || hasPermission("setting:update")
		: isAdmin;
	const canDeleteWorkspace = isOwner || hasPermission("organization:delete");
	const canManageRoles =
		isOwner || hasPermission("ac:create") || hasPermission("ac:update");

	return {
		activeOrg: activeOrg.data,
		activeOrgId,
		canDeleteWorkspace,
		canManageMembers,
		canManageRoles,
		canManageSettings,
		currentMember,
		currentUserRole,
		effectivePermissions,
		error: fullOrgQuery.error,
		fullOrg,
		hasPermission,
		isAdmin,
		isError: fullOrgQuery.isError,
		isListPending: listOrgs.isPending,
		isLoading:
			activeOrg.isPending || (Boolean(activeOrgId) && fullOrgQuery.isPending),
		isOwner,
		isPermissionsPending: Boolean(activeOrgId) && myPermissionsQuery.isPending,
		organizations: listOrgs.data ?? [],
		refetch: fullOrgQuery.refetch,
		session: session.data,
	};
}

export interface OrganizationMutationsOptions {
	onSuccessNavigate?: (path: string) => void;
	showToasts?: boolean;
}

export async function syncOrganizationClientState(
	queryClient: ReturnType<typeof useQueryClient>,
	organizationId?: string
) {
	authClient.$store.notify("$listOrg");
	authClient.$store.notify("$activeOrgSignal");
	authClient.$store.notify("$sessionSignal");
	await queryClient.invalidateQueries({ queryKey: organizationKeys.all });
	if (organizationId) {
		await queryClient.invalidateQueries({
			queryKey: organizationKeys.detail(organizationId),
		});
	}
}

function unwrapAuthResult<T>(
	res: { data?: T; error?: { message?: string } | null },
	fallback: string
): T {
	if (res.error) {
		throw new Error(res.error.message || fallback);
	}
	return res.data as T;
}

function useOrgMutation<TData, TVariables>(params: {
	errorFallback: string;
	mutationFn: (variables: TVariables) => Promise<TData>;
	onAfterSuccess?: (data: TData, variables: TVariables) => void;
	resolveOrgId: (data: TData, variables: TVariables) => string | undefined;
	showToasts: boolean;
	successMessage?: (data: TData, variables: TVariables) => string;
}) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: params.mutationFn,
		onError: (error) => {
			if (params.showToasts) {
				toast.error(
					error instanceof Error ? error.message : params.errorFallback
				);
			}
		},
		onSuccess: async (data, variables) => {
			await syncOrganizationClientState(
				queryClient,
				params.resolveOrgId(data, variables)
			);
			if (params.showToasts && params.successMessage) {
				toast.success(params.successMessage(data, variables));
			}
			params.onAfterSuccess?.(data, variables);
		},
	});
}

export function useOrganizationMutations(
	options: OrganizationMutationsOptions = {}
) {
	const showToasts = options.showToasts ?? true;

	const createOrgMutation = useOrgMutation({
		errorFallback: "Failed to create organization",
		mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
			const res = await authClient.organization.create({
				keepCurrentActiveOrganization: false,
				name,
				slug,
			});
			return unwrapAuthResult(res, "Failed to create organization");
		},
		resolveOrgId: (data) => data?.id,
		showToasts,
		successMessage: () => "Organization created successfully",
	});

	const setActiveOrgMutation = useOrgMutation({
		errorFallback: "Failed to switch organization",
		mutationFn: async ({
			organizationId,
		}: {
			organizationId: string | null;
		}) => {
			const res = await authClient.organization.setActive({
				organizationId,
			});
			return unwrapAuthResult(res, "Failed to switch organization");
		},
		resolveOrgId: (_data, variables) => variables.organizationId ?? undefined,
		showToasts,
	});

	const updateOrgMutation = useOrgMutation({
		errorFallback: "Failed to update organization",
		mutationFn: async ({
			logo,
			metadata,
			name,
			organizationId,
			slug,
		}: {
			logo?: string | null;
			metadata?: Record<string, unknown>;
			name?: string;
			organizationId: string;
			slug?: string;
		}) => {
			const payloadData: {
				logo?: string | null;
				metadata?: Record<string, unknown>;
				name?: string;
				slug?: string;
			} = {};

			if (name !== undefined) {
				payloadData.name = name;
			}
			if (slug !== undefined) {
				payloadData.slug = slug;
			}
			if (metadata !== undefined) {
				payloadData.metadata = metadata;
			}
			if (logo !== undefined) {
				payloadData.logo = logo;
			}

			const response = await client.api.organizations.current.$patch(
				{ json: payloadData },
				orgHeadersInit(organizationId)
			);
			return await parseApiResponse<{
				id: string;
				logo: string | null;
				metadata: string | null;
				name: string;
				slug: string | null;
			}>(response);
		},
		resolveOrgId: (_data, variables) => variables.organizationId,
		showToasts,
		successMessage: () => "Organization updated successfully",
	});

	const inviteMemberMutation = useOrgMutation({
		errorFallback: "Failed to invite member",
		mutationFn: async ({
			email,
			organizationId,
			resend,
			role,
		}: {
			email: string;
			organizationId: string;
			resend?: boolean;
			role: string;
		}) => {
			const res = await authClient.organization.inviteMember({
				email,
				organizationId,
				resend,
				role: role as never,
			});
			return unwrapAuthResult(res, "Failed to invite member");
		},
		resolveOrgId: (_data, variables) => variables.organizationId,
		showToasts,
		successMessage: (_data, variables) =>
			variables.resend
				? `Invitation resent to ${variables.email}`
				: `Invitation sent to ${variables.email}`,
	});

	const cancelInvitationMutation = useOrgMutation({
		errorFallback: "Failed to cancel invitation",
		mutationFn: async ({
			invitationId,
		}: {
			invitationId: string;
			organizationId?: string;
		}) => {
			const res = await authClient.organization.cancelInvitation({
				invitationId,
			});
			return unwrapAuthResult(res, "Failed to cancel invitation");
		},
		resolveOrgId: (_data, variables) => variables.organizationId,
		showToasts,
		successMessage: () => "Invitation canceled",
	});

	const updateMemberRoleMutation = useOrgMutation({
		errorFallback: "Failed to update member role",
		mutationFn: async ({
			memberId,
			organizationId,
			role,
		}: {
			memberId: string;
			organizationId: string;
			role: string;
		}) => {
			const res = await authClient.organization.updateMemberRole({
				memberId,
				organizationId,
				role: role as never,
			});
			return unwrapAuthResult(res, "Failed to update member role");
		},
		resolveOrgId: (_data, variables) => variables.organizationId,
		showToasts,
		successMessage: () => "Member role updated",
	});

	const removeMemberMutation = useOrgMutation({
		errorFallback: "Failed to remove member",
		mutationFn: async ({
			memberId,
			organizationId,
		}: {
			memberId: string;
			organizationId: string;
		}) => {
			const response = await client.api.organizations.members[
				":memberId"
			].$delete({ param: { memberId } }, orgHeadersInit(organizationId));
			return await parseApiResponse<{
				member: {
					id: string;
					organizationId: string;
					role: string;
					userId: string;
				};
			}>(response);
		},
		resolveOrgId: (_data, variables) => variables.organizationId,
		showToasts,
		successMessage: () => "Member removed from organization",
	});

	const transferOwnershipMutation = useOrgMutation({
		errorFallback: "Failed to transfer ownership",
		mutationFn: async ({
			newOwnerUserId,
			organizationId,
		}: {
			newOwnerUserId: string;
			organizationId: string;
		}) => {
			const response = await client.api.organizations[
				"transfer-ownership"
			].$post({ json: { newOwnerUserId } }, orgHeadersInit(organizationId));
			return await parseApiResponse<{
				newOwnerUserId: string;
				organizationId: string;
				previousOwnerUserId: string;
			}>(response);
		},
		resolveOrgId: (_data, variables) => variables.organizationId,
		showToasts,
		successMessage: () => "Organization ownership transferred",
	});

	const leaveOrganizationMutation = useOrgMutation({
		errorFallback: "Failed to leave organization",
		mutationFn: async ({ organizationId }: { organizationId: string }) => {
			const res = await authClient.organization.leave({
				organizationId,
			});
			return unwrapAuthResult(res, "Failed to leave organization");
		},
		onAfterSuccess: () => {
			options.onSuccessNavigate?.("/dashboard");
		},
		resolveOrgId: (_data, variables) => variables.organizationId,
		showToasts,
		successMessage: () => "You have left the organization",
	});

	const deleteOrganizationMutation = useOrgMutation({
		errorFallback: "Failed to delete organization",
		mutationFn: async ({ organizationId }: { organizationId: string }) => {
			const res = await authClient.organization.delete({
				organizationId,
			});
			return unwrapAuthResult(res, "Failed to delete organization");
		},
		onAfterSuccess: () => {
			options.onSuccessNavigate?.("/dashboard");
		},
		resolveOrgId: (_data, variables) => variables.organizationId,
		showToasts,
		successMessage: () => "Organization permanently deleted",
	});

	const isSubmitting =
		createOrgMutation.isPending ||
		setActiveOrgMutation.isPending ||
		updateOrgMutation.isPending ||
		inviteMemberMutation.isPending ||
		cancelInvitationMutation.isPending ||
		updateMemberRoleMutation.isPending ||
		removeMemberMutation.isPending ||
		transferOwnershipMutation.isPending ||
		leaveOrganizationMutation.isPending ||
		deleteOrganizationMutation.isPending;

	return {
		cancelInvitation: cancelInvitationMutation.mutateAsync,
		createOrganization: createOrgMutation.mutateAsync,
		deleteOrganization: deleteOrganizationMutation.mutateAsync,
		inviteMember: inviteMemberMutation.mutateAsync,
		isCancelingInvitation: cancelInvitationMutation.isPending,
		isCreatingOrganization: createOrgMutation.isPending,
		isDeletingOrganization: deleteOrganizationMutation.isPending,
		isInvitingMember: inviteMemberMutation.isPending,
		isLeavingOrganization: leaveOrganizationMutation.isPending,
		isRemovingMember: removeMemberMutation.isPending,
		isSettingActiveOrganization: setActiveOrgMutation.isPending,
		isSubmitting,
		isTransferringOwnership: transferOwnershipMutation.isPending,
		isUpdatingMemberRole: updateMemberRoleMutation.isPending,
		isUpdatingOrganization: updateOrgMutation.isPending,
		leaveOrganization: leaveOrganizationMutation.mutateAsync,
		removeMember: removeMemberMutation.mutateAsync,
		setActiveOrganization: setActiveOrgMutation.mutateAsync,
		transferOwnership: transferOwnershipMutation.mutateAsync,
		updateMemberRole: updateMemberRoleMutation.mutateAsync,
		updateOrganization: updateOrgMutation.mutateAsync,
	};
}

function useInvalidateOrganizationRoles(organizationId?: string) {
	const queryClient = useQueryClient();
	return async () => {
		if (!organizationId) {
			await queryClient.invalidateQueries({ queryKey: organizationKeys.all });
			return;
		}
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: organizationKeys.roles(organizationId),
			}),
			queryClient.invalidateQueries({
				queryKey: [...organizationKeys.all, "roles", organizationId, "me"],
			}),
			queryClient.invalidateQueries({
				queryKey: organizationKeys.detail(organizationId),
			}),
		]);
	};
}

function useOrganizationRoleMutation<TData, TVariables>(params: {
	errorFallback: string;
	mutationFn: (orgId: string, variables: TVariables) => Promise<TData>;
	organizationId?: string;
	successMessage: (data: TData) => string;
}) {
	const invalidateRoles = useInvalidateOrganizationRoles(params.organizationId);
	return useMutation({
		mutationFn: async (variables: TVariables) => {
			if (!params.organizationId) {
				throw new Error("No active organization selected");
			}
			return await params.mutationFn(params.organizationId, variables);
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : params.errorFallback
			);
		},
		onSuccess: async (data) => {
			await invalidateRoles();
			toast.success(params.successMessage(data));
		},
	});
}

export function useCreateOrganizationRole(organizationId?: string) {
	return useOrganizationRoleMutation({
		errorFallback: "Failed to create role",
		mutationFn: async (
			orgId,
			input: { permissions: string[]; slug: string }
		) => {
			const res = await authClient.organization.createRole({
				organizationId: orgId,
				permission: permissionKeysToMap(input.permissions),
				role: input.slug,
			});
			const data = unwrapAuthResult(
				res,
				"Failed to create role"
			) as unknown as {
				id?: string;
				role?: string;
			};
			return {
				id: data.id ?? "",
				name: formatCustomRoleName(data.role ?? input.slug),
				slug: data.role ?? input.slug,
			};
		},
		organizationId,
		successMessage: (role) => `Role "${role.name}" created`,
	});
}

export function useUpdateOrganizationRole(organizationId?: string) {
	return useOrganizationRoleMutation({
		errorFallback: "Failed to update role",
		mutationFn: async (
			orgId,
			{
				id,
				permissions,
				slug,
			}: {
				id: string;
				permissions?: string[];
				slug?: string;
			}
		) => {
			const res = await authClient.organization.updateRole({
				data: {
					...(permissions
						? { permission: permissionKeysToMap(permissions) }
						: {}),
					...(slug ? { roleName: slug } : {}),
				},
				organizationId: orgId,
				roleId: id,
			});
			const data = unwrapAuthResult(
				res,
				"Failed to update role"
			) as unknown as { roleData?: { role?: string } };
			const updatedSlug = data.roleData?.role ?? slug ?? "role";
			return {
				id,
				name: formatCustomRoleName(updatedSlug),
				slug: updatedSlug,
			};
		},
		organizationId,
		successMessage: (role) => `Role "${role.name}" updated`,
	});
}

export function useDeleteOrganizationRole(organizationId?: string) {
	return useOrganizationRoleMutation({
		errorFallback: "Failed to delete role",
		mutationFn: async (orgId, { id }: { id: string }) => {
			const res = await authClient.organization.deleteRole({
				organizationId: orgId,
				roleId: id,
			});
			return unwrapAuthResult(res, "Failed to delete role");
		},
		organizationId,
		successMessage: () => "Role deleted",
	});
}
