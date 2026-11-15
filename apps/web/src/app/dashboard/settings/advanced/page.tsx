"use client";

import { parseMemberRoles } from "@workspace/api/permissions";
import { Button } from "@workspace/ui/components/button";
import { DeleteConfirmationDialog } from "@workspace/ui/components/delete-confirmation-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Label } from "@workspace/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import {
	SettingsPage,
	SettingsSection,
	SettingsSectionContent,
} from "@workspace/ui/components/settings-shell";
import { AlertCircle, Crown, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
	useCurrentOrganization,
	useOrganizationMutations,
} from "@/lib/organization-hooks";

export default function AdvancedSettingsPage() {
	const router = useRouter();
	const selectNewOwnerId = useId();
	const { fullOrg, activeOrgId, isOwner, canDeleteWorkspace, session } =
		useCurrentOrganization();
	const {
		deleteOrganization,
		isSubmitting,
		isTransferringOwnership,
		transferOwnership,
	} = useOrganizationMutations({
		onSuccessNavigate: (path) => router.push(path),
	});

	const [isTransferOpen, setIsTransferOpen] = useState(false);
	const [selectedTransferUserId, setSelectedTransferUserId] = useState("");

	const orgName = fullOrg?.name || "Workspace";
	const orgSlug = fullOrg?.slug || "workspace";
	const members = fullOrg?.members ?? [];

	// Eligible members for transfer: active administrators other than the current owner
	const eligibleTransferMembers = members.filter(
		(m) =>
			m.userId !== session?.user.id &&
			parseMemberRoles(m.role).includes("admin")
	);

	const handleTransferOwnership = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!(activeOrgId && selectedTransferUserId)) {
			return;
		}

		try {
			await transferOwnership({
				newOwnerUserId: selectedTransferUserId,
				organizationId: activeOrgId,
			});
			setIsTransferOpen(false);
			setSelectedTransferUserId("");
		} catch {
			// Error toast handled by useOrganizationMutations
		}
	};

	const handleDeleteConfirm = async () => {
		if (!activeOrgId) {
			return;
		}
		await deleteOrganization({ organizationId: activeOrgId });
	};

	return (
		<SettingsPage
			description="Manage workspace ownership, transfers, and deletion settings."
			title="Advanced Settings"
		>
			{/* Ownership Transfer Section */}
			<SettingsSection>
				<SettingsSectionContent className="space-y-4">
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="space-y-1">
							<p className="text-foreground text-sm font-semibold">
								Designate New Primary Owner
							</p>
							<p className="text-muted-foreground max-w-xl text-xs leading-relaxed">
								Transferring ownership assigns full administrative and deletion
								control to the designated member. Your role will be converted to
								Admin.
							</p>
						</div>

						<Button
							className="shrink-0 gap-2 shadow-xs"
							disabled={!isOwner || eligibleTransferMembers.length === 0}
							onClick={() => setIsTransferOpen(true)}
							variant="outline"
						>
							<Crown className="h-4 w-4 text-amber-500" />
							Transfer Ownership
						</Button>
					</div>

					{isOwner && eligibleTransferMembers.length === 0 ? (
						<div className="border-muted bg-muted/20 text-muted-foreground flex items-center gap-2 rounded-xl border p-3 text-xs">
							<AlertCircle className="text-muted-foreground h-4 w-4 shrink-0" />
							<span>
								You need at least one other active Administrator in this
								workspace to transfer ownership.
							</span>
						</div>
					) : null}
				</SettingsSectionContent>
			</SettingsSection>

			{/* Delete Workspace Section */}
			<SettingsSection className="border-destructive/30 bg-destructive/5">
				<SettingsSectionContent className="space-y-4">
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="space-y-1">
							<p className="text-destructive text-sm font-bold">
								Delete Workspace Permanently
							</p>
							<p className="text-muted-foreground max-w-xl text-xs leading-relaxed">
								Once initiated, this organization and all associated AI threads,
								cloud storage assets, and team invitations will be permanently
								removed. This action is irreversible.
							</p>
						</div>

						<DeleteConfirmationDialog
							confirmationKeyword={orgSlug}
							description={`This action will permanently delete "${orgName}" (${orgSlug}) and disconnect all team members. To confirm, please type the workspace slug below.`}
							disabled={!canDeleteWorkspace || isSubmitting}
							onConfirm={handleDeleteConfirm}
							title="Delete Organization Workspace"
						>
							<Button
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90 shrink-0 gap-2 shadow-xs"
								disabled={!canDeleteWorkspace || isSubmitting}
								variant="destructive"
							>
								<Trash2 className="h-4 w-4" />
								Delete Workspace
							</Button>
						</DeleteConfirmationDialog>
					</div>
				</SettingsSectionContent>
			</SettingsSection>

			{/* Transfer Ownership Modal Dialog */}
			<Dialog
				onOpenChange={(open) => {
					setIsTransferOpen(open);
					if (!open) {
						setSelectedTransferUserId("");
					}
				}}
				open={isTransferOpen}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-lg font-bold">
							<KeyRound className="h-5 w-5 text-amber-500" />
							Transfer Workspace Ownership
						</DialogTitle>
						<DialogDescription className="text-xs leading-relaxed">
							Select an existing administrator to assume full ownership
							authority for{" "}
							<span className="text-foreground font-semibold">{orgName}</span>.
						</DialogDescription>
					</DialogHeader>

					<form className="space-y-4 py-2" onSubmit={handleTransferOwnership}>
						<div className="space-y-1.5">
							<Label className="text-xs font-medium" htmlFor={selectNewOwnerId}>
								Select New Owner
							</Label>
							<Select
								onValueChange={setSelectedTransferUserId}
								value={selectedTransferUserId}
							>
								<SelectTrigger id={selectNewOwnerId}>
									<SelectValue placeholder="Choose an administrator..." />
								</SelectTrigger>
								<SelectContent>
									{eligibleTransferMembers.map((m) => (
										<SelectItem key={m.id} value={m.userId}>
											{m.user.name} ({m.user.email})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs text-amber-700 dark:text-amber-400">
							<strong>Warning:</strong> You will be demoted to an Admin role
							immediately upon confirmation and will relinquish ownership and
							deletion privileges.
						</div>

						<DialogFooter className="pt-2">
							<Button
								disabled={isTransferringOwnership}
								onClick={() => {
									setIsTransferOpen(false);
									setSelectedTransferUserId("");
								}}
								size="sm"
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
							<Button
								disabled={!selectedTransferUserId || isTransferringOwnership}
								size="sm"
								type="submit"
								variant="primary"
							>
								{isTransferringOwnership ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Transferring...
									</>
								) : (
									"Confirm Transfer"
								)}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</SettingsPage>
	);
}
