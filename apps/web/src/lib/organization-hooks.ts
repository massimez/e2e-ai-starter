"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	isOrgAdminRole,
	parseMemberRoles,
} from "@workspace/shared/permissions";
import { toast } from "sonner";
import { client, parseApiResponse } from "./api-client";
import { authClient } from "./auth-client";
import {
	organizationKeys,
	unwrapAuthResult,
	useMyOrganizationPermissions,
} from "./organization-role-hooks";

export {
	organizationKeys,
	useCreateOrganizationRole,
	useDeleteOrganizationRole,
	useMyOrganizationPermissions,
	useOrganizationRoles,
	useUpdateOrganizationRole,
} from "./organization-role-hooks";

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

export function orgHeadersInit(organizationId?: string) {
	return organizationId
		? { headers: { "x-organization-id": organizationId } }
		: undefined;
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
