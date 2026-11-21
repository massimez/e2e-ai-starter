"use client";

import {
	ORGANIZATION_PERMISSION_GROUPS,
	type OrganizationPermissionGroup,
	type OrganizationRoleSummary,
} from "@workspace/shared/permissions";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Checkbox, type CheckedState } from "@workspace/ui/components/checkbox";
import { DeleteConfirmationDialog } from "@workspace/ui/components/delete-confirmation-dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	SettingsPage,
	SettingsSection,
	SettingsSectionContent,
} from "@workspace/ui/components/settings-shell";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn, sanitizeSlug } from "@workspace/ui/lib/utils";
import {
	Copy,
	Loader2,
	Lock,
	Plus,
	Save,
	Search,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { RoleBadge } from "@/components/role-badge";
import {
	useCreateOrganizationRole,
	useCurrentOrganization,
	useDeleteOrganizationRole,
	useOrganizationRoles,
	useUpdateOrganizationRole,
} from "@/lib/organization-hooks";

const RESOURCE_SEPARATOR_REGEX = /[-_]+/gu;
const LEADING_WORD_CHAR_REGEX = /^\w/u;

function formatResourceLabel(resource: string): string {
	return resource
		.replace(RESOURCE_SEPARATOR_REGEX, " ")
		.replace(LEADING_WORD_CHAR_REGEX, (char) => char.toUpperCase());
}

function getCheckedState(selected: number, total: number): CheckedState {
	if (total > 0 && selected === total) {
		return true;
	}
	if (selected > 0) {
		return "indeterminate";
	}
	return false;
}

function samePermissions(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	const setA = new Set(a);
	return b.every((item) => setA.has(item));
}

function resolveRoleSubtitle(
	isCreating: boolean,
	selectedRole: OrganizationRoleSummary | null
): string {
	if (isCreating) {
		return "Enter a lowercase slug and toggle permissions granted to members assigned this role.";
	}
	if (selectedRole?.isSystem) {
		return "Built-in system roles are read-only. Duplicate to create an editable custom variant.";
	}
	return "Update this custom role's slug or granted permissions.";
}

function RolesSidebar({
	canManageRoles,
	isCreating,
	onSelectRole,
	onStartCreate,
	roles,
	selectedRoleId,
}: {
	canManageRoles: boolean;
	isCreating: boolean;
	onSelectRole: (role: OrganizationRoleSummary) => void;
	onStartCreate: () => void;
	roles: OrganizationRoleSummary[];
	selectedRoleId: string | null;
}) {
	return (
		<SettingsSection>
			<SettingsSectionContent className="space-y-3 p-4">
				<div className="flex items-center justify-between gap-2">
					<h2 className="text-sm font-semibold">Workspace Roles</h2>
					{canManageRoles ? (
						<Button
							onClick={onStartCreate}
							size="sm"
							type="button"
							variant="outline"
						>
							<Plus className="mr-1.5 h-3.5 w-3.5" />
							New Role
						</Button>
					) : null}
				</div>

				<div className="space-y-1.5">
					{roles.map((role) => {
						const active = !isCreating && selectedRoleId === role.id;
						return (
							<button
								className={cn(
									"w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
									active
										? "border-primary/40 bg-primary/5"
										: "border-border/50 hover:bg-muted/40"
								)}
								key={role.id}
								onClick={() => onSelectRole(role)}
								type="button"
							>
								<div className="flex items-center justify-between gap-2">
									<RoleBadge label={role.name} role={role.slug} />
									{role.isSystem ? (
										<Lock className="text-muted-foreground h-3.5 w-3.5" />
									) : null}
								</div>
								<p className="text-muted-foreground mt-1.5 font-mono text-[11px]">
									{role.permissions.length} permission
									{role.permissions.length === 1 ? "" : "s"}
								</p>
							</button>
						);
					})}
				</div>
			</SettingsSectionContent>
		</SettingsSection>
	);
}

function PermissionGroupCard({
	disabled,
	group,
	onToggle,
	selectedSet,
}: {
	disabled: boolean;
	group: OrganizationPermissionGroup;
	onToggle: (keys: string[], checked: boolean) => void;
	selectedSet: Set<string>;
}) {
	const selectedCount = group.permissions.filter((p) =>
		selectedSet.has(p.key)
	).length;
	const groupState = getCheckedState(selectedCount, group.permissions.length);

	return (
		<div className="border-border/60 rounded-xl border p-4">
			<div className="mb-3 flex items-center justify-between gap-2">
				<div className="flex items-center gap-2.5">
					<Checkbox
						aria-label={`Toggle all ${group.resource} permissions`}
						checked={groupState}
						disabled={disabled}
						onCheckedChange={(checked) =>
							onToggle(
								group.permissions.map((p) => p.key),
								checked === true
							)
						}
					/>
					<span className="text-sm font-semibold">
						{formatResourceLabel(group.resource)}
					</span>
				</div>
				<span className="text-muted-foreground font-mono text-[11px]">
					{selectedCount}/{group.permissions.length}
				</span>
			</div>
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{group.permissions.map((permission) => {
					const checked = selectedSet.has(permission.key);
					return (
						<label
							className={cn(
								"border-border/50 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
								disabled
									? "cursor-default opacity-80"
									: "hover:bg-muted/40 cursor-pointer",
								checked ? "bg-muted/30 border-border" : ""
							)}
							key={permission.key}
						>
							<Checkbox
								checked={checked}
								disabled={disabled}
								onCheckedChange={(next) =>
									onToggle([permission.key], next === true)
								}
							/>
							<span className="font-mono">{permission.action}</span>
						</label>
					);
				})}
			</div>
		</div>
	);
}

function RoleEditorPanel({
	canManageRoles,
	filter,
	filterInputId,
	filteredCatalog,
	isCreating,
	isDirty,
	isEditable,
	isSaving,
	onCancelCreate,
	onDeleteOpen,
	onDuplicate,
	onFilterChange,
	onSave,
	onSlugChange,
	onTogglePermissions,
	selectedRole,
	selectedSet,
	slug,
	slugInputId,
}: {
	canManageRoles: boolean;
	filter: string;
	filterInputId: string;
	filteredCatalog: OrganizationPermissionGroup[];
	isCreating: boolean;
	isDirty: boolean;
	isEditable: boolean;
	isSaving: boolean;
	onCancelCreate: () => void;
	onDeleteOpen: () => void;
	onDuplicate: () => void;
	onFilterChange: (value: string) => void;
	onSave: (event: React.FormEvent) => void;
	onSlugChange: (value: string) => void;
	onTogglePermissions: (keys: string[], checked: boolean) => void;
	selectedRole: OrganizationRoleSummary | null;
	selectedSet: Set<string>;
	slug: string;
	slugInputId: string;
}) {
	return (
		<SettingsSection>
			<SettingsSectionContent className="p-6">
				<form className="space-y-6" onSubmit={onSave}>
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="space-y-1">
							<div className="flex items-center gap-2">
								<ShieldCheck className="text-primary h-4 w-4" />
								<h2 className="text-base font-semibold">
									{isCreating
										? "Create Custom Role"
										: selectedRole?.name || "Role Details"}
								</h2>
								{!isCreating && selectedRole?.isSystem ? (
									<Badge variant="outline">System</Badge>
								) : null}
							</div>
							<p className="text-muted-foreground text-xs">
								{resolveRoleSubtitle(isCreating, selectedRole)}
							</p>
						</div>

						{!isCreating && selectedRole && canManageRoles ? (
							<div className="flex items-center gap-2">
								<Button
									onClick={onDuplicate}
									size="sm"
									type="button"
									variant="outline"
								>
									<Copy className="mr-1.5 h-3.5 w-3.5" />
									Duplicate
								</Button>
								{selectedRole.isSystem ? null : (
									<Button
										onClick={onDeleteOpen}
										size="sm"
										type="button"
										variant="destructive"
									>
										<Trash2 className="mr-1.5 h-3.5 w-3.5" />
										Delete
									</Button>
								)}
							</div>
						) : null}
					</div>

					<div className="space-y-1.5">
						<Label className="text-xs font-medium" htmlFor={slugInputId}>
							Role Slug
						</Label>
						<Input
							className="max-w-sm font-mono text-xs"
							disabled={!isEditable}
							id={slugInputId}
							onChange={(event) => onSlugChange(event.target.value)}
							placeholder="e.g. billing-analyst"
							required
							value={slug}
						/>
					</div>

					<div className="space-y-3">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<h3 className="text-sm font-semibold">Permissions</h3>
								<p className="text-muted-foreground text-xs">
									Toggle individual capabilities by workspace resource.
								</p>
							</div>
							<div className="relative w-full sm:w-56">
								<Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5" />
								<Input
									aria-label="Filter permissions"
									className="h-8 pl-8 text-xs"
									id={filterInputId}
									onChange={(event) => onFilterChange(event.target.value)}
									placeholder="Filter resources..."
									value={filter}
								/>
							</div>
						</div>

						<div className="space-y-3">
							{filteredCatalog.map((group) => (
								<PermissionGroupCard
									disabled={!isEditable}
									group={group}
									key={group.resource}
									onToggle={onTogglePermissions}
									selectedSet={selectedSet}
								/>
							))}
						</div>
					</div>

					{isEditable ? (
						<div className="border-border/60 flex items-center justify-end gap-2 border-t pt-4">
							{isCreating ? (
								<Button
									onClick={onCancelCreate}
									type="button"
									variant="outline"
								>
									Cancel
								</Button>
							) : null}
							<Button
								disabled={
									isSaving ||
									sanitizeSlug(slug).length < 2 ||
									!(isCreating || isDirty)
								}
								type="submit"
							>
								{isSaving ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<Save className="mr-2 h-4 w-4" />
								)}
								{isCreating ? "Create Role" : "Save Changes"}
							</Button>
						</div>
					) : null}
				</form>
			</SettingsSectionContent>
		</SettingsSection>
	);
}

export default function RolesSettingsPage() {
	const slugInputId = useId();
	const filterInputId = useId();
	const {
		activeOrgId,
		canManageRoles,
		isLoading: orgLoading,
	} = useCurrentOrganization();

	const rolesQuery = useOrganizationRoles(activeOrgId);

	const createRoleMutation = useCreateOrganizationRole(activeOrgId);
	const updateRoleMutation = useUpdateOrganizationRole(activeOrgId);
	const deleteRoleMutation = useDeleteOrganizationRole(activeOrgId);

	const roles = rolesQuery.data ?? [];

	const [isCreating, setIsCreating] = useState(false);
	const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
	const [slug, setSlug] = useState("");
	const [permissions, setPermissions] = useState<string[]>([]);
	const [filter, setFilter] = useState("");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	const selectedRole = useMemo(
		() => roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null,
		[roles, selectedRoleId]
	);

	useEffect(() => {
		if (!isCreating && selectedRole) {
			setSelectedRoleId(selectedRole.id);
			setSlug(selectedRole.slug);
			setPermissions([...selectedRole.permissions]);
		}
	}, [isCreating, selectedRole]);

	const filteredCatalog = useMemo(() => {
		const term = filter.trim().toLowerCase();
		if (!term) {
			return ORGANIZATION_PERMISSION_GROUPS;
		}
		return ORGANIZATION_PERMISSION_GROUPS.filter(
			(group) =>
				group.resource.toLowerCase().includes(term) ||
				group.permissions.some((item) => item.key.toLowerCase().includes(term))
		);
	}, [filter]);

	const selectedSet = useMemo(() => new Set(permissions), [permissions]);
	const isEditable =
		canManageRoles && (isCreating || selectedRole?.isSystem === false);
	const isDirty =
		isCreating ||
		Boolean(
			selectedRole &&
				(slug !== selectedRole.slug ||
					!samePermissions(permissions, selectedRole.permissions))
		);
	const isSaving = createRoleMutation.isPending || updateRoleMutation.isPending;

	const handleTogglePermissions = (keys: string[], checked: boolean) => {
		setPermissions((current) => {
			const next = new Set(current);
			for (const key of keys) {
				if (checked) {
					next.add(key);
				} else {
					next.delete(key);
				}
			}
			return Array.from(next);
		});
	};

	const handleStartCreate = (seed?: OrganizationRoleSummary) => {
		setIsCreating(true);
		setSlug(seed ? sanitizeSlug(`${seed.slug}-custom`).slice(0, 64) : "");
		setPermissions(seed ? [...seed.permissions] : []);
	};

	const handleSelectRole = (role: OrganizationRoleSummary) => {
		setIsCreating(false);
		setSelectedRoleId(role.id);
		setSlug(role.slug);
		setPermissions([...role.permissions]);
	};

	const handleSave = async (event: React.FormEvent) => {
		event.preventDefault();
		const cleanSlug = sanitizeSlug(slug).slice(0, 64);
		if (cleanSlug.length < 2) {
			return;
		}

		if (isCreating) {
			const created = await createRoleMutation.mutateAsync({
				permissions,
				slug: cleanSlug,
			});
			setIsCreating(false);
			if (created.id) {
				setSelectedRoleId(created.id);
			}
			return;
		}

		if (selectedRole && !selectedRole.isSystem) {
			await updateRoleMutation.mutateAsync({
				id: selectedRole.id,
				permissions,
				slug: cleanSlug === selectedRole.slug ? undefined : cleanSlug,
			});
		}
	};

	const handleDelete = async () => {
		if (!selectedRole || selectedRole.isSystem) {
			return;
		}
		await deleteRoleMutation.mutateAsync({ id: selectedRole.id });
		setDeleteDialogOpen(false);
		setSelectedRoleId(roles[0]?.id ?? null);
	};

	if (orgLoading || rolesQuery.isPending) {
		return (
			<SettingsPage
				description="Review built-in access levels and manage custom workspace roles."
				title="Roles & Permissions"
			>
				<SettingsSection>
					<SettingsSectionContent className="space-y-4">
						<Skeleton className="h-10 w-64" />
						<Skeleton className="h-64 w-full" />
					</SettingsSectionContent>
				</SettingsSection>
			</SettingsPage>
		);
	}

	return (
		<SettingsPage
			description="Built-in system roles are enforced across every route. Admins and owners can define additional custom workspace roles via Better Auth Dynamic Access Control."
			title="Roles & Permissions"
		>
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
				<RolesSidebar
					canManageRoles={canManageRoles}
					isCreating={isCreating}
					onSelectRole={handleSelectRole}
					onStartCreate={() => handleStartCreate()}
					roles={roles}
					selectedRoleId={selectedRole?.id ?? null}
				/>

				<RoleEditorPanel
					canManageRoles={canManageRoles}
					filter={filter}
					filteredCatalog={filteredCatalog}
					filterInputId={filterInputId}
					isCreating={isCreating}
					isDirty={isDirty}
					isEditable={isEditable}
					isSaving={isSaving}
					onCancelCreate={() => setIsCreating(false)}
					onDeleteOpen={() => setDeleteDialogOpen(true)}
					onDuplicate={() =>
						selectedRole ? handleStartCreate(selectedRole) : undefined
					}
					onFilterChange={setFilter}
					onSave={handleSave}
					onSlugChange={(next) => setSlug(sanitizeSlug(next))}
					onTogglePermissions={handleTogglePermissions}
					selectedRole={selectedRole}
					selectedSet={selectedSet}
					slug={slug}
					slugInputId={slugInputId}
				/>
			</div>

			<DeleteConfirmationDialog
				confirmLabel="Delete Role"
				description={`Delete custom role "${selectedRole?.name}"? Roles assigned to members cannot be deleted.`}
				disabled={deleteRoleMutation.isPending}
				onConfirm={handleDelete}
				onOpenChange={setDeleteDialogOpen}
				open={deleteDialogOpen}
				title="Delete Custom Role"
			/>
		</SettingsPage>
	);
}
