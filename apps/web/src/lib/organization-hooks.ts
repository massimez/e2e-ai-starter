"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	isOrgAdminRole,
	type OrganizationRoleName,
	parseMemberRoles,
} from "@workspace/api/permissions";
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

export const organizationKeys = {
	all: ["organizations"] as const,
	detail: (organizationId: string) =>
		[...organizationKeys.all, "detail", organizationId] as const,
	list: () => [...organizationKeys.all, "list"] as const,
};

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
	const roles = parseMemberRoles(currentUserRole);

	const isOwner = roles.includes("owner");
	const isAdmin = isOrgAdminRole(currentUserRole);
	const canManageMembers = isAdmin;
	const canManageSettings = isAdmin;
	const canDeleteWorkspace = isOwner;

	return {
		activeOrg: activeOrg.data,
		activeOrgId,
		canDeleteWorkspace,
		canManageMembers,
		canManageSettings,
		currentMember,
		currentUserRole,
		error: fullOrgQuery.error,
		fullOrg,
		isAdmin,
		isError: fullOrgQuery.isError,
		isListPending: listOrgs.isPending,
		isLoading:
			activeOrg.isPending || (Boolean(activeOrgId) && fullOrgQuery.isPending),
		isOwner,
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

export function useOrganizationMutations(
	options: OrganizationMutationsOptions = {}
) {
	const queryClient = useQueryClient();
	const showToasts = options.showToasts ?? true;

	const invalidateAll = async (organizationId?: string) => {
		await syncOrganizationClientState(queryClient, organizationId);
	};

	const notifySuccess = (message: string) => {
		if (showToasts) {
			toast.success(message);
		}
	};

	const notifyError = (error: unknown, fallback: string) => {
		if (showToasts) {
			toast.error(error instanceof Error ? error.message : fallback);
		}
	};

	const createOrgMutation = useMutation({
		mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
			const res = await authClient.organization.create({
				keepCurrentActiveOrganization: false,
				name,
				slug,
			});
			if (res.error) {
				throw new Error(res.error.message || "Failed to create organization");
			}
			return res.data;
		},
		onError: (error) => {
			notifyError(error, "Failed to create organization");
		},
		onSuccess: async (data) => {
			await invalidateAll(data?.id);
			notifySuccess("Organization created successfully");
		},
	});

	const setActiveOrgMutation = useMutation({
		mutationFn: async ({
			organizationId,
		}: {
			organizationId: string | null;
		}) => {
			const res = await authClient.organization.setActive({
				organizationId,
			});
			if (res.error) {
				throw new Error(res.error.message || "Failed to switch organization");
			}
			return res.data;
		},
		onError: (error) => {
			notifyError(error, "Failed to switch organization");
		},
		onSuccess: async (_data, variables) => {
			await invalidateAll(variables.organizationId ?? undefined);
		},
	});

	const updateOrgMutation = useMutation({
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
				logo?: string;
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
				// Passing empty string/null clears logo cleanly through adapter
				payloadData.logo = (logo ?? "") as string;
			}

			const res = await authClient.organization.update({
				data: payloadData,
				organizationId,
			});

			if (res.error) {
				throw new Error(res.error.message || "Failed to update organization");
			}
			return res.data;
		},
		onError: (error) => {
			notifyError(error, "Failed to update organization");
		},
		onSuccess: async (_data, variables) => {
			await invalidateAll(variables.organizationId);
			notifySuccess("Organization updated successfully");
		},
	});

	const inviteMemberMutation = useMutation({
		mutationFn: async ({
			email,
			organizationId,
			role,
		}: {
			email: string;
			organizationId: string;
			role: OrganizationRoleName;
		}) => {
			const res = await authClient.organization.inviteMember({
				email,
				organizationId,
				role,
			});
			if (res.error) {
				throw new Error(res.error.message || "Failed to invite member");
			}
			return res.data;
		},
		onError: (error) => {
			notifyError(error, "Failed to invite member");
		},
		onSuccess: async (_data, variables) => {
			await invalidateAll(variables.organizationId);
			notifySuccess(`Invitation sent to ${variables.email}`);
		},
	});

	const cancelInvitationMutation = useMutation({
		mutationFn: async ({ invitationId }: { invitationId: string }) => {
			const res = await authClient.organization.cancelInvitation({
				invitationId,
			});
			if (res.error) {
				throw new Error(res.error.message || "Failed to cancel invitation");
			}
			return res.data;
		},
		onError: (error) => {
			notifyError(error, "Failed to cancel invitation");
		},
		onSuccess: async () => {
			await invalidateAll();
			notifySuccess("Invitation canceled");
		},
	});

	const updateMemberRoleMutation = useMutation({
		mutationFn: async ({
			memberId,
			organizationId,
			role,
		}: {
			memberId: string;
			organizationId: string;
			role: OrganizationRoleName;
		}) => {
			const res = await authClient.organization.updateMemberRole({
				memberId,
				organizationId,
				role,
			});
			if (res.error) {
				throw new Error(res.error.message || "Failed to update member role");
			}
			return res.data;
		},
		onError: (error) => {
			notifyError(error, "Failed to update member role");
		},
		onSuccess: async (_data, variables) => {
			await invalidateAll(variables.organizationId);
			notifySuccess("Member role updated");
		},
	});

	const removeMemberMutation = useMutation({
		mutationFn: async ({
			memberId,
			organizationId,
		}: {
			memberId: string;
			organizationId: string;
		}) => {
			const res = await authClient.organization.removeMember({
				memberIdOrEmail: memberId,
				organizationId,
			});
			if (res.error) {
				throw new Error(res.error.message || "Failed to remove member");
			}
			return res.data;
		},
		onError: (error) => {
			notifyError(error, "Failed to remove member");
		},
		onSuccess: async (_data, variables) => {
			await invalidateAll(variables.organizationId);
			notifySuccess("Member removed from organization");
		},
	});

	const transferOwnershipMutation = useMutation({
		mutationFn: async ({
			newOwnerUserId,
			organizationId,
		}: {
			newOwnerUserId: string;
			organizationId: string;
		}) => {
			const response = await client.api.organizations[
				"transfer-ownership"
			].$post(
				{ json: { newOwnerUserId } },
				{ init: { headers: { "x-organization-id": organizationId } } }
			);
			return await parseApiResponse<{
				newOwnerUserId: string;
				organizationId: string;
				previousOwnerUserId: string;
			}>(response);
		},
		onError: (error) => {
			notifyError(error, "Failed to transfer ownership");
		},
		onSuccess: async (_data, variables) => {
			await invalidateAll(variables.organizationId);
			notifySuccess("Organization ownership transferred");
		},
	});

	const leaveOrganizationMutation = useMutation({
		mutationFn: async ({ organizationId }: { organizationId: string }) => {
			const res = await authClient.organization.leave({
				organizationId,
			});
			if (res.error) {
				throw new Error(res.error.message || "Failed to leave organization");
			}
			return res.data;
		},
		onError: (error) => {
			notifyError(error, "Failed to leave organization");
		},
		onSuccess: async (_data, variables) => {
			await invalidateAll(variables.organizationId);
			notifySuccess("You have left the organization");
			options.onSuccessNavigate?.("/dashboard");
		},
	});

	const deleteOrganizationMutation = useMutation({
		mutationFn: async ({ organizationId }: { organizationId: string }) => {
			const res = await authClient.organization.delete({
				organizationId,
			});
			if (res.error) {
				throw new Error(res.error.message || "Failed to delete organization");
			}
			return res.data;
		},
		onError: (error) => {
			notifyError(error, "Failed to delete organization");
		},
		onSuccess: async (_data, variables) => {
			await invalidateAll(variables.organizationId);
			notifySuccess("Organization permanently deleted");
			options.onSuccessNavigate?.("/dashboard");
		},
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
