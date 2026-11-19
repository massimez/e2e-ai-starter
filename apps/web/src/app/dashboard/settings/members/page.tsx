"use client";

import { Button } from "@workspace/ui/components/button";
import { DeleteConfirmationDialog } from "@workspace/ui/components/delete-confirmation-dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	SettingsPage,
	SettingsSection,
	SettingsSectionContent,
} from "@workspace/ui/components/settings-shell";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@workspace/ui/components/tabs";
import { Loader2, Mail, Plus, Search, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import {
	type OrganizationInvitation,
	type OrganizationMember,
	useCurrentOrganization,
	useOrganizationMutations,
	useOrganizationRoles,
} from "@/lib/organization-hooks";
import { InvitationsTable } from "./_components/invitations-table";
import { InviteMemberDialog } from "./_components/invite-member-dialog";
import { MembersTable } from "./_components/members-table";

export default function MembersSettingsPage() {
	const router = useRouter();
	const searchInputId = useId();

	const {
		fullOrg,
		activeOrgId,
		canManageMembers,
		isLoading,
		isOwner,
		session,
	} = useCurrentOrganization();

	const {
		inviteMember,
		cancelInvitation,
		updateMemberRole,
		removeMember,
		leaveOrganization,
		isSubmitting,
	} = useOrganizationMutations({
		onSuccessNavigate: (path) => router.push(path),
	});

	const rolesQuery = useOrganizationRoles(activeOrgId);
	const roles = rolesQuery.data ?? [];

	const assignableRoles = useMemo(
		() =>
			roles.filter(
				(role) => role.slug !== "owner" && (isOwner || role.slug !== "admin")
			),
		[isOwner, roles]
	);

	const defaultRoleSlug = useMemo(
		() =>
			assignableRoles.find((role) => role.isDefault)?.slug ??
			assignableRoles[0]?.slug ??
			"member",
		[assignableRoles]
	);

	const roleNameBySlug = useMemo(
		() => new Map(roles.map((role) => [role.slug, role.name])),
		[roles]
	);

	const [searchQuery, setSearchQuery] = useState("");
	const [isInviteOpen, setIsInviteOpen] = useState(false);
	const [memberToRemove, setMemberToRemove] =
		useState<OrganizationMember | null>(null);
	const [invitationToCancel, setInvitationToCancel] =
		useState<OrganizationInvitation | null>(null);
	const [isLeaveOpen, setIsLeaveOpen] = useState(false);

	const members = fullOrg?.members ?? [];
	const invitations = (fullOrg?.invitations ?? []).filter(
		(inv) => inv.status === "pending"
	);

	const query = searchQuery.toLowerCase();
	const filteredMembers = members.filter(
		(m) =>
			m.user.name?.toLowerCase().includes(query) ||
			m.user.email?.toLowerCase().includes(query) ||
			m.role?.toLowerCase().includes(query)
	);
	const filteredInvitations = invitations.filter(
		(inv) =>
			inv.email.toLowerCase().includes(query) ||
			inv.role.toLowerCase().includes(query)
	);

	const handleInvite = async (input: { email: string; role: string }) => {
		if (!activeOrgId) {
			return;
		}
		await inviteMember({
			email: input.email,
			organizationId: activeOrgId,
			role: input.role,
		});
	};

	const handleRoleChange = async (memberId: string, role: string) => {
		if (!activeOrgId) {
			return;
		}
		try {
			await updateMemberRole({
				memberId,
				organizationId: activeOrgId,
				role,
			});
		} catch {
			// Toast handled in mutation
		}
	};

	const handleConfirmRemove = async () => {
		if (!(activeOrgId && memberToRemove)) {
			return;
		}
		try {
			await removeMember({
				memberId: memberToRemove.id,
				organizationId: activeOrgId,
			});
			setMemberToRemove(null);
		} catch {
			// Toast handled in mutation
		}
	};

	const handleConfirmCancelInvite = async () => {
		if (!invitationToCancel) {
			return;
		}
		try {
			await cancelInvitation({
				invitationId: invitationToCancel.id,
				organizationId: activeOrgId,
			});
			setInvitationToCancel(null);
		} catch {
			// Toast handled in mutation
		}
	};

	const handleConfirmLeave = async () => {
		if (!activeOrgId) {
			return;
		}
		try {
			await leaveOrganization({
				organizationId: activeOrgId,
			});
			setIsLeaveOpen(false);
		} catch {
			// Toast handled in mutation
		}
	};

	if (isLoading && !fullOrg) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="text-primary h-8 w-8 animate-spin" />
			</div>
		);
	}

	return (
		<SettingsPage
			action={
				canManageMembers ? (
					<Button
						className="gap-2 shadow-xs"
						onClick={() => setIsInviteOpen(true)}
						size="sm"
						variant="primary"
					>
						<UserPlus className="h-4 w-4" />
						Invite Team Member
					</Button>
				) : null
			}
			description="Manage workspace team members, role assignments, and pending invitations."
			title="Team Members & Collaboration"
		>
			<SettingsSection>
				<SettingsSectionContent className="space-y-6">
					<Tabs defaultValue="members">
						<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							<TabsList className="bg-muted/40 p-1">
								<TabsTrigger className="gap-2 text-xs" value="members">
									<Users className="h-4 w-4" />
									Active Members ({members.length})
								</TabsTrigger>
								<TabsTrigger className="gap-2 text-xs" value="invitations">
									<Mail className="h-4 w-4" />
									Pending Invitations ({invitations.length})
								</TabsTrigger>
							</TabsList>

							<div className="relative w-full sm:w-72">
								<Label className="sr-only" htmlFor={searchInputId}>
									Filter team members
								</Label>
								<Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
								<Input
									className="pl-9"
									id={searchInputId}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder="Filter by name, email, or role..."
									value={searchQuery}
								/>
							</div>
						</div>

						<TabsContent className="pt-3" value="members">
							<MembersTable
								assignableRoles={assignableRoles}
								canManageMembers={canManageMembers}
								currentUserId={session?.user.id}
								isOwner={isOwner}
								members={filteredMembers}
								onLeave={() => setIsLeaveOpen(true)}
								onRemove={setMemberToRemove}
								onRoleChange={handleRoleChange}
								roleNameBySlug={roleNameBySlug}
							/>
						</TabsContent>

						<TabsContent className="space-y-4 pt-3" value="invitations">
							{canManageMembers ? (
								<div className="flex justify-end">
									<Button
										className="gap-2"
										onClick={() => setIsInviteOpen(true)}
										size="sm"
										variant="outline"
									>
										<Plus className="h-4 w-4" />
										Invite Another Member
									</Button>
								</div>
							) : null}

							<InvitationsTable
								canManageMembers={canManageMembers}
								invitations={filteredInvitations}
								onRevoke={setInvitationToCancel}
								roleNameBySlug={roleNameBySlug}
							/>
						</TabsContent>
					</Tabs>
				</SettingsSectionContent>
			</SettingsSection>

			<InviteMemberDialog
				assignableRoles={assignableRoles}
				canAssignAdmin={isOwner}
				defaultRoleSlug={defaultRoleSlug}
				isSubmitting={isSubmitting}
				onInvite={handleInvite}
				onOpenChange={setIsInviteOpen}
				open={isInviteOpen}
			/>

			<DeleteConfirmationDialog
				confirmLabel="Remove Member"
				description={`Are you sure you want to remove ${memberToRemove?.user.name ?? ""} (${memberToRemove?.user.email ?? ""}) from this workspace? They will immediately lose access to all resources.`}
				onConfirm={handleConfirmRemove}
				onOpenChange={(open) => {
					if (!open) {
						setMemberToRemove(null);
					}
				}}
				open={Boolean(memberToRemove)}
				title="Remove Team Member"
			/>

			<DeleteConfirmationDialog
				confirmLabel="Revoke Invite"
				description={`Are you sure you want to cancel the invitation sent to ${invitationToCancel?.email ?? ""}? The link sent to them will be invalidated.`}
				onConfirm={handleConfirmCancelInvite}
				onOpenChange={(open) => {
					if (!open) {
						setInvitationToCancel(null);
					}
				}}
				open={Boolean(invitationToCancel)}
				title="Revoke Invitation"
			/>

			<DeleteConfirmationDialog
				confirmLabel="Leave Workspace"
				description="Are you sure you want to leave this organization? You will need an invite from an administrator to rejoin."
				onConfirm={handleConfirmLeave}
				onOpenChange={setIsLeaveOpen}
				open={isLeaveOpen}
				title="Leave Workspace"
			/>
		</SettingsPage>
	);
}
