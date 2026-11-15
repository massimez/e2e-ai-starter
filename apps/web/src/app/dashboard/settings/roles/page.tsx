"use client";

import type {
	OrganizationPermissionGroup,
	OrganizationRoleSummary,
} from "@workspace/api/permissions";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Checkbox, type CheckedState } from "@workspace/ui/components/checkbox";
import { DeleteConfirmationDialog } from "@workspace/ui/components/delete-confirmation-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	SettingsPage,
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import {
	Copy,
	KeyRound,
	Loader2,
	Lock,
	Plus,
	Save,
	Search,
	ShieldCheck,
	Trash2,
	Users,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { RoleBadge } from "@/components/role-badge";
import {
	useCloneOrganizationRole,
	useCreateOrganizationRole,
	useCurrentOrganization,
	useDeleteOrganizationRole,
	useOrganizationPermissionsCatalog,
	useOrganizationRoles,
	useUpdateOrganizationRole,
} from "@/lib/organization-hooks";

const NON_ALNUM_REGEX = /[^a-z0-9]+/gu;
const EDGE_HYPHENS_REGEX = /^-+|-+$/gu;
const CAMEL_CASE_BOUNDARY_REGEX = /(?<upper>[A-Z])/gu;
const RESOURCE_SEPARATOR_REGEX = /[-_]+/gu;
const LEADING_WORD_CHAR_REGEX = /^\w/u;

function slugifyRoleInput(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(NON_ALNUM_REGEX, "-")
		.replace(EDGE_HYPHENS_REGEX, "")
		.slice(0, 80);
}

function formatResourceLabel(resource: string): string {
	return resource
		.replace(CAMEL_CASE_BOUNDARY_REGEX, " $<upper>")
		.replace(RESOURCE_SEPARATOR_REGEX, " ")
		.replace(LEADING_WORD_CHAR_REGEX, (char) => char.toUpperCase());
}

function getResourceCheckedState(
	checkedCount: number,
	totalCount: number
): CheckedState {
	if (totalCount > 0 && checkedCount === totalCount) {
		return true;
	}
	if (checkedCount > 0) {
		return "indeterminate";
	}
	return false;
}

function getRoleEditorDescription(
	isCreating: boolean,
	isOwnerRole: boolean,
	isSystemRole: boolean
): string {
	if (isCreating) {
		return "Define a slug and choose which workspace capabilities this role grants.";
	}
	if (isOwnerRole) {
		return "The Owner role has unrestricted access across every workspace resource and cannot be modified.";
	}
	if (isSystemRole) {
		return "Built-in system role. Its slug is locked, while delegable permissions remain customizable.";
	}
	return "Customize metadata and toggle granular permissions for this role.";
}

interface RoleFormState {
	description: string;
	isDefault: boolean;
	name: string;
	permissions: string[];
	slug: string;
}

function roleToFormState(role: OrganizationRoleSummary): RoleFormState {
	return {
		description: role.description ?? "",
		isDefault: role.isDefault,
		name: role.name,
		permissions: [...role.permissions],
		slug: role.slug,
	};
}

function createEmptyRoleForm(): RoleFormState {
	return {
		description: "",
		isDefault: false,
		name: "",
		permissions: [],
		slug: "",
	};
}

function RoleListItem({
	isSelected,
	onSelect,
	role,
}: {
	isSelected: boolean;
	onSelect: () => void;
	role: OrganizationRoleSummary;
}) {
	return (
		<button
			className={cn(
				"flex w-full flex-col gap-2 rounded-xl border p-3.5 text-left transition-all",
				isSelected
					? "border-primary/60 bg-primary/5 ring-primary/20 ring-2"
					: "border-border/60 bg-card/60 hover:border-border hover:bg-muted/40"
			)}
			onClick={onSelect}
			type="button"
		>
			<div className="flex items-start justify-between gap-2">
				<RoleBadge label={role.name} role={role.slug} />
				<div className="flex flex-wrap items-center justify-end gap-1">
					{role.isDefault ? (
						<Badge className="text-[10px]" variant="secondary">
							Default
						</Badge>
					) : null}
					{role.isSystem ? (
						<Badge className="gap-1 text-[10px]" variant="outline">
							<Lock className="h-2.5 w-2.5" />
							System
						</Badge>
					) : null}
				</div>
			</div>
			<div className="text-muted-foreground flex items-center justify-between text-xs">
				<span className="inline-flex items-center gap-1">
					<Users className="h-3 w-3" />
					{role.memberCount} {role.memberCount === 1 ? "member" : "members"}
				</span>
				<span>{role.permissions.length} permissions</span>
			</div>
		</button>
	);
}

function RoleListPane({
	isCreating,
	isPending,
	onSelectRole,
	roles,
	selectedRoleId,
}: {
	isCreating: boolean;
	isPending: boolean;
	onSelectRole: (role: OrganizationRoleSummary) => void;
	roles: OrganizationRoleSummary[];
	selectedRoleId: string | null;
}) {
	const renderListBody = () => {
		if (isPending) {
			return (
				<>
					<Skeleton className="h-16 w-full rounded-xl" />
					<Skeleton className="h-16 w-full rounded-xl" />
					<Skeleton className="h-16 w-full rounded-xl" />
				</>
			);
		}
		if (roles.length === 0) {
			return (
				<p className="text-muted-foreground py-4 text-center text-sm">
					No roles found for this workspace.
				</p>
			);
		}
		return roles.map((role) => (
			<RoleListItem
				isSelected={!isCreating && selectedRoleId === role.id}
				key={role.id}
				onSelect={() => onSelectRole(role)}
				role={role}
			/>
		));
	};

	return (
		<SettingsSection className="h-fit">
			<SettingsSectionHeader
				description="System and custom roles in this organization."
				title="Workspace Roles"
			/>
			<SettingsSectionContent className="space-y-2.5">
				{renderListBody()}
			</SettingsSectionContent>
		</SettingsSection>
	);
}

function PermissionGroupCard({
	disabled,
	group,
	onTogglePermissions,
	selectedSet,
}: {
	disabled: boolean;
	group: OrganizationPermissionGroup;
	onTogglePermissions: (keys: string[], checked: boolean) => void;
	selectedSet: Set<string>;
}) {
	const groupKeys = group.permissions.map((item) => item.key);
	const checkedCount = groupKeys.filter((key) => selectedSet.has(key)).length;
	const resourceChecked = getResourceCheckedState(
		checkedCount,
		groupKeys.length
	);

	return (
		<div className="border-border/60 bg-background/60 rounded-xl border p-4">
			<div className="border-border/50 mb-3 flex items-center justify-between gap-3 border-b pb-2.5">
				<div className="flex items-center gap-2.5">
					<Checkbox
						aria-label={`Select all ${group.resource} permissions`}
						checked={resourceChecked}
						disabled={disabled}
						onCheckedChange={(checked) =>
							onTogglePermissions(groupKeys, checked)
						}
					/>
					<span className="text-sm font-semibold">
						{formatResourceLabel(group.resource)}
					</span>
				</div>
				<Badge className="font-mono text-[11px]" variant="secondary">
					{checkedCount}/{groupKeys.length}
				</Badge>
			</div>
			<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
				{group.permissions.map((item) => {
					const isChecked = selectedSet.has(item.key);
					const checkboxId = `perm-${item.key}`;
					return (
						<label
							className={cn(
								"flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
								isChecked
									? "border-primary/40 bg-primary/5"
									: "border-border/50 bg-card/40",
								disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
							)}
							htmlFor={checkboxId}
							key={item.key}
						>
							<Checkbox
								checked={isChecked}
								disabled={disabled}
								id={checkboxId}
								onCheckedChange={(checked) =>
									onTogglePermissions([item.key], checked)
								}
							/>
							<span className="font-medium capitalize">{item.action}</span>
						</label>
					);
				})}
			</div>
		</div>
	);
}

function PermissionCatalogSection({
	canReadCatalog,
	disabled,
	filteredCatalog,
	isPending,
	onFilterChange,
	onTogglePermissions,
	permissionFilter,
	selectedPermissionSet,
}: {
	canReadCatalog: boolean;
	disabled: boolean;
	filteredCatalog: OrganizationPermissionGroup[];
	isPending: boolean;
	onFilterChange: (value: string) => void;
	onTogglePermissions: (keys: string[], checked: boolean) => void;
	permissionFilter: string;
	selectedPermissionSet: Set<string>;
}) {
	const searchInputId = useId();

	const renderCatalogBody = () => {
		if (isPending) {
			return (
				<div className="space-y-3">
					<Skeleton className="h-24 w-full rounded-xl" />
					<Skeleton className="h-24 w-full rounded-xl" />
				</div>
			);
		}
		if (filteredCatalog.length === 0) {
			return (
				<div className="border-border/60 rounded-xl border border-dashed p-6 text-center text-sm">
					<p className="text-muted-foreground">
						{canReadCatalog
							? "No permissions match your search filter."
							: "Permission catalog unavailable for this role."}
					</p>
				</div>
			);
		}
		return (
			<div className="space-y-3">
				{filteredCatalog.map((group) => (
					<PermissionGroupCard
						disabled={disabled}
						group={group}
						key={group.resource}
						onTogglePermissions={onTogglePermissions}
						selectedSet={selectedPermissionSet}
					/>
				))}
			</div>
		);
	};

	return (
		<div className="space-y-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h3 className="text-sm font-semibold">Permission Catalog</h3>
					<p className="text-muted-foreground text-xs">
						Non-delegable role management, member administration, and workspace
						deletion remain owner-exclusive.
					</p>
				</div>
				<div className="relative w-full sm:w-56">
					<Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5" />
					<Input
						aria-label="Filter permissions"
						className="h-8 pl-8 text-xs"
						id={searchInputId}
						onChange={(event) => onFilterChange(event.target.value)}
						placeholder="Filter resources..."
						value={permissionFilter}
					/>
				</div>
			</div>
			{renderCatalogBody()}
		</div>
	);
}

function CloneRoleDialog({
	isPending,
	onClone,
	onOpenChange,
	open,
	sourceRole,
}: {
	isPending: boolean;
	onClone: (input: {
		description?: string;
		name: string;
		slug?: string;
	}) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	sourceRole: OrganizationRoleSummary | null;
}) {
	const nameId = useId();
	const slugId = useId();
	const descriptionId = useId();
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugTouched, setSlugTouched] = useState(false);
	const [description, setDescription] = useState("");

	useEffect(() => {
		if (open && sourceRole) {
			const nextName = `${sourceRole.name} Copy`;
			setName(nextName);
			setSlug(slugifyRoleInput(nextName));
			setSlugTouched(false);
			setDescription(sourceRole.description ?? "");
		}
	}, [open, sourceRole]);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!name.trim()) {
			return;
		}
		await onClone({
			description: description.trim() || undefined,
			name: name.trim(),
			slug: slug.trim() || undefined,
		});
		onOpenChange(false);
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Clone Role</DialogTitle>
					<DialogDescription>
						Create a new custom role starting from &ldquo;
						{sourceRole?.name ?? ""}&rdquo;. Non-delegable system permissions
						are excluded automatically.
					</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="space-y-2">
						<Label htmlFor={nameId}>Role Name</Label>
						<Input
							id={nameId}
							onChange={(event) => {
								const nextName = event.target.value;
								setName(nextName);
								if (!slugTouched) {
									setSlug(slugifyRoleInput(nextName));
								}
							}}
							placeholder="e.g. Finance Reviewer"
							required
							value={name}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor={slugId}>Role Slug</Label>
						<Input
							id={slugId}
							onChange={(event) => {
								setSlugTouched(true);
								setSlug(event.target.value.toLowerCase());
							}}
							placeholder="finance-reviewer"
							required
							value={slug}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor={descriptionId}>Description</Label>
						<Textarea
							id={descriptionId}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Optional summary of responsibilities"
							rows={3}
							value={description}
						/>
					</div>
					<DialogFooter>
						<Button
							disabled={isPending}
							onClick={() => onOpenChange(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={isPending || name.trim().length < 2}
							type="submit"
						>
							{isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Copy className="mr-2 h-4 w-4" />
							)}
							Clone Role
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RoleHeaderActions({
	canDeleteSelected,
	canManageRoles,
	isCreating,
	onDelete,
	onOpenClone,
	selectedRole,
}: {
	canDeleteSelected: boolean;
	canManageRoles: boolean;
	isCreating: boolean;
	onDelete: () => Promise<void>;
	onOpenClone: () => void;
	selectedRole: OrganizationRoleSummary | null;
}) {
	if (isCreating || !selectedRole || !canManageRoles) {
		return null;
	}

	const deleteDescription =
		selectedRole.memberCount > 0
			? `Reassign all ${selectedRole.memberCount} assigned member(s) before deleting this role.`
			: `Permanently delete the "${selectedRole.name}" role? This action cannot be undone.`;

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button onClick={onOpenClone} size="sm" type="button" variant="outline">
				<Copy className="mr-1.5 h-3.5 w-3.5" />
				Clone
			</Button>
			{selectedRole.isSystem ? null : (
				<DeleteConfirmationDialog
					confirmLabel="Delete Role"
					description={deleteDescription}
					disabled={!canDeleteSelected}
					onConfirm={onDelete}
					title={`Delete ${selectedRole.name}?`}
				>
					<Button
						disabled={!canDeleteSelected}
						size="sm"
						title={
							selectedRole.memberCount > 0
								? "Reassign members before deleting this role"
								: "Delete custom role"
						}
						type="button"
						variant="destructive"
					>
						<Trash2 className="mr-1.5 h-3.5 w-3.5" />
						Delete
					</Button>
				</DeleteConfirmationDialog>
			)}
		</div>
	);
}

function RoleMetadataFields({
	formState,
	isCreating,
	isEditable,
	isSystemRole,
	onNameChange,
	onSlugChange,
	setFormState,
}: {
	formState: RoleFormState;
	isCreating: boolean;
	isEditable: boolean;
	isSystemRole: boolean;
	onNameChange: (nextName: string) => void;
	onSlugChange: (nextSlug: string) => void;
	setFormState: React.Dispatch<React.SetStateAction<RoleFormState>>;
}) {
	const nameInputId = useId();
	const slugInputId = useId();
	const descInputId = useId();
	const defaultSwitchId = useId();

	return (
		<>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor={nameInputId}>Display Name</Label>
					<Input
						disabled={!isEditable}
						id={nameInputId}
						onChange={(event) => onNameChange(event.target.value)}
						placeholder="e.g. Finance Reviewer"
						required
						value={formState.name}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor={slugInputId}>Role Slug</Label>
					<Input
						disabled={!isEditable || (!isCreating && isSystemRole)}
						id={slugInputId}
						onChange={(event) => onSlugChange(event.target.value.toLowerCase())}
						placeholder="finance-reviewer"
						required
						value={formState.slug}
					/>
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor={descInputId}>Description</Label>
				<Textarea
					disabled={!isEditable}
					id={descInputId}
					onChange={(event) =>
						setFormState((prev) => ({
							...prev,
							description: event.target.value,
						}))
					}
					placeholder="Describe what members with this role are allowed to do"
					rows={2}
					value={formState.description}
				/>
			</div>

			<div className="border-border/60 bg-muted/20 flex items-center justify-between gap-4 rounded-xl border p-4">
				<div className="space-y-0.5">
					<Label htmlFor={defaultSwitchId}>Default Invite Role</Label>
					<p className="text-muted-foreground text-xs">
						Pre-selected automatically when inviting new workspace members.
					</p>
				</div>
				<Switch
					checked={formState.isDefault}
					disabled={!isEditable}
					id={defaultSwitchId}
					onCheckedChange={(checked) =>
						setFormState((prev) => ({ ...prev, isDefault: checked }))
					}
				/>
			</div>
		</>
	);
}

function RoleEditorPanel({
	builtInSystemGrants,
	canReadCatalog,
	catalogPending,
	filteredCatalog,
	formState,
	isCreating,
	isDirty,
	isEditable,
	isOwnerRole,
	isPending,
	isSaving,
	onCancelCreate,
	onFilterChange,
	onNameChange,
	onSlugChange,
	onSubmit,
	onTogglePermissions,
	permissionFilter,
	selectedPermissionSet,
	selectedRole,
	setFormState,
}: {
	builtInSystemGrants: string[];
	canReadCatalog: boolean;
	catalogPending: boolean;
	filteredCatalog: OrganizationPermissionGroup[];
	formState: RoleFormState;
	isCreating: boolean;
	isDirty: boolean;
	isEditable: boolean;
	isOwnerRole: boolean;
	isPending: boolean;
	isSaving: boolean;
	onCancelCreate: () => void;
	onFilterChange: (value: string) => void;
	onNameChange: (nextName: string) => void;
	onSlugChange: (nextSlug: string) => void;
	onSubmit: (event: React.FormEvent) => Promise<void>;
	onTogglePermissions: (keys: string[], checked: boolean) => void;
	permissionFilter: string;
	selectedPermissionSet: Set<string>;
	selectedRole: OrganizationRoleSummary | null;
	setFormState: React.Dispatch<React.SetStateAction<RoleFormState>>;
}) {
	if (isPending && !isCreating) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-48 w-full" />
			</div>
		);
	}

	if (!(isCreating || selectedRole)) {
		return (
			<p className="text-muted-foreground py-8 text-center text-sm">
				Select a role on the left to inspect or edit its permissions.
			</p>
		);
	}

	return (
		<form className="space-y-6" onSubmit={onSubmit}>
			{isOwnerRole ? (
				<div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-800 dark:text-amber-300">
					<ShieldCheck className="h-5 w-5 shrink-0" />
					<span>
						Owner bypasses dynamic restrictions and automatically holds every
						workspace permission. You can still clone Owner as a starting
						template for custom roles.
					</span>
				</div>
			) : null}

			<RoleMetadataFields
				formState={formState}
				isCreating={isCreating}
				isEditable={isEditable}
				isSystemRole={Boolean(selectedRole?.isSystem)}
				onNameChange={onNameChange}
				onSlugChange={onSlugChange}
				setFormState={setFormState}
			/>

			{builtInSystemGrants.length > 0 ? (
				<div className="border-border/60 bg-muted/20 space-y-2 rounded-xl border p-4">
					<div className="flex items-center gap-2 text-xs font-semibold">
						<KeyRound className="h-3.5 w-3.5" />
						<span>Protected System Capabilities (Locked)</span>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{builtInSystemGrants.map((grant) => (
							<Badge
								className="font-mono text-[11px]"
								key={grant}
								variant="outline"
							>
								{grant}
							</Badge>
						))}
					</div>
				</div>
			) : null}

			<PermissionCatalogSection
				canReadCatalog={canReadCatalog}
				disabled={!isEditable}
				filteredCatalog={filteredCatalog}
				isPending={catalogPending}
				onFilterChange={onFilterChange}
				onTogglePermissions={onTogglePermissions}
				permissionFilter={permissionFilter}
				selectedPermissionSet={selectedPermissionSet}
			/>

			{isEditable ? (
				<div className="border-border/60 flex items-center justify-end gap-2 border-t pt-4">
					{isCreating ? (
						<Button onClick={onCancelCreate} type="button" variant="outline">
							Cancel
						</Button>
					) : null}
					<Button
						disabled={
							isSaving ||
							formState.name.trim().length < 2 ||
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
	);
}

export default function RolesSettingsPage() {
	const {
		activeOrgId,
		canManageRoles,
		hasPermission,
		isLoading: orgLoading,
	} = useCurrentOrganization();
	const canReadCatalog = hasPermission("role:read");

	const rolesQuery = useOrganizationRoles(activeOrgId);
	const catalogQuery = useOrganizationPermissionsCatalog(
		activeOrgId,
		canReadCatalog
	);

	const createRoleMutation = useCreateOrganizationRole(activeOrgId);
	const updateRoleMutation = useUpdateOrganizationRole(activeOrgId);
	const deleteRoleMutation = useDeleteOrganizationRole(activeOrgId);
	const cloneRoleMutation = useCloneOrganizationRole(activeOrgId);

	const roles = rolesQuery.data ?? [];
	const catalog = catalogQuery.data ?? [];

	const [mode, setMode] = useState<"view" | "create">("view");
	const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
	const [formState, setFormState] = useState<RoleFormState>(
		createEmptyRoleForm()
	);
	const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
	const [permissionFilter, setPermissionFilter] = useState("");
	const [cloneDialogOpen, setCloneDialogOpen] = useState(false);

	const selectedRole = useMemo(
		() => roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null,
		[roles, selectedRoleId]
	);

	useEffect(() => {
		if (mode === "view" && selectedRole) {
			setSelectedRoleId(selectedRole.id);
			setFormState(roleToFormState(selectedRole));
			setSlugManuallyEdited(true);
		}
	}, [mode, selectedRole]);

	const catalogKeySet = useMemo(() => {
		const keys = new Set<string>();
		for (const group of catalog) {
			for (const permission of group.permissions) {
				keys.add(permission.key);
			}
		}
		return keys;
	}, [catalog]);

	const filteredCatalog = useMemo(() => {
		const term = permissionFilter.trim().toLowerCase();
		if (!term) {
			return catalog;
		}
		return catalog.flatMap((group) => {
			if (group.resource.toLowerCase().includes(term)) {
				return [group];
			}
			const matchingPermissions = group.permissions.filter((item) =>
				item.key.toLowerCase().includes(term)
			);
			return matchingPermissions.length > 0
				? [{ permissions: matchingPermissions, resource: group.resource }]
				: [];
		});
	}, [catalog, permissionFilter]);

	const isCreating = mode === "create";
	const isOwnerRole = !isCreating && selectedRole?.slug === "owner";
	const isEditable = canManageRoles && (isCreating || !isOwnerRole);
	const isSaving = createRoleMutation.isPending || updateRoleMutation.isPending;

	const selectedPermissionSet = useMemo(
		() => new Set(formState.permissions),
		[formState.permissions]
	);

	const builtInSystemGrants = useMemo(() => {
		if (isCreating || !selectedRole?.isSystem || catalogKeySet.size === 0) {
			return [];
		}
		return selectedRole.permissions.filter((key) => !catalogKeySet.has(key));
	}, [catalogKeySet, isCreating, selectedRole]);

	const isDirty = useMemo(() => {
		if (isCreating) {
			return (
				formState.name.trim().length > 0 || formState.permissions.length > 0
			);
		}
		if (!selectedRole) {
			return false;
		}
		const prevPerms = [...selectedRole.permissions].sort().join("|");
		const nextPerms = [...formState.permissions].sort().join("|");
		return (
			formState.name !== selectedRole.name ||
			formState.slug !== selectedRole.slug ||
			formState.description !== (selectedRole.description ?? "") ||
			formState.isDefault !== selectedRole.isDefault ||
			prevPerms !== nextPerms
		);
	}, [formState, isCreating, selectedRole]);

	const handleSelectRole = (role: OrganizationRoleSummary) => {
		setMode("view");
		setSelectedRoleId(role.id);
		setFormState(roleToFormState(role));
		setSlugManuallyEdited(true);
	};

	const handleStartCreate = () => {
		setMode("create");
		setFormState(createEmptyRoleForm());
		setSlugManuallyEdited(false);
	};

	const handleTogglePermissions = (keys: string[], checked: boolean) => {
		setFormState((prev) => {
			const next = new Set(prev.permissions);
			for (const key of keys) {
				if (checked) {
					next.add(key);
				} else {
					next.delete(key);
				}
			}
			return { ...prev, permissions: [...next].sort() };
		});
	};

	const handleSubmitForm = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!isEditable) {
			return;
		}

		const delegablePermissions = formState.permissions.filter((key) =>
			catalogKeySet.has(key)
		);

		if (isCreating) {
			const created = await createRoleMutation.mutateAsync({
				description: formState.description.trim() || undefined,
				isDefault: formState.isDefault,
				name: formState.name.trim(),
				permissions: delegablePermissions,
				slug: formState.slug.trim() || undefined,
			});
			setMode("view");
			setSelectedRoleId(created.id);
			return;
		}

		if (!selectedRole) {
			return;
		}

		await updateRoleMutation.mutateAsync({
			description: formState.description.trim() || null,
			id: selectedRole.id,
			isDefault: formState.isDefault,
			name: formState.name.trim(),
			permissions: delegablePermissions,
			slug: selectedRole.isSystem ? undefined : formState.slug.trim(),
		});
	};

	const handleDeleteSelected = async () => {
		if (!selectedRole) {
			return;
		}
		await deleteRoleMutation.mutateAsync({ id: selectedRole.id });
		setSelectedRoleId(null);
	};

	const handleCloneRole = async (input: {
		description?: string;
		name: string;
		slug?: string;
	}) => {
		if (!selectedRole) {
			return;
		}
		const cloned = await cloneRoleMutation.mutateAsync({
			...input,
			id: selectedRole.id,
		});
		setMode("view");
		setSelectedRoleId(cloned.id);
	};

	const canDeleteSelected =
		canManageRoles &&
		!isCreating &&
		Boolean(selectedRole) &&
		!selectedRole?.isSystem &&
		(selectedRole?.memberCount ?? 0) === 0;

	const editorDescription = getRoleEditorDescription(
		isCreating,
		isOwnerRole,
		Boolean(selectedRole?.isSystem)
	);

	return (
		<SettingsPage
			action={
				canManageRoles ? (
					<Button onClick={handleStartCreate} size="sm" type="button">
						<Plus className="mr-1.5 h-4 w-4" />
						New Role
					</Button>
				) : undefined
			}
			description="Create custom roles and tailor fine-grained permissions enforced dynamically across workspace APIs, storage, and AI execution."
			headingLevel="h2"
			title="Roles & Dynamic Permissions"
		>
			{canManageRoles || orgLoading ? null : (
				<div className="border-border/70 bg-muted/40 text-muted-foreground flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm">
					<Lock className="h-4 w-4 shrink-0" />
					<span>
						Read-only access. Only the organization owner can create, edit, or
						assign workspace roles.
					</span>
				</div>
			)}

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
				<RoleListPane
					isCreating={isCreating}
					isPending={rolesQuery.isPending}
					onSelectRole={handleSelectRole}
					roles={roles}
					selectedRoleId={selectedRole?.id ?? null}
				/>

				<SettingsSection>
					<SettingsSectionHeader
						action={
							<RoleHeaderActions
								canDeleteSelected={canDeleteSelected}
								canManageRoles={canManageRoles}
								isCreating={isCreating}
								onDelete={handleDeleteSelected}
								onOpenClone={() => setCloneDialogOpen(true)}
								selectedRole={selectedRole}
							/>
						}
						description={editorDescription}
						title={
							isCreating
								? "Create Custom Role"
								: (selectedRole?.name ?? "Select a Role")
						}
					/>
					<SettingsSectionContent>
						<RoleEditorPanel
							builtInSystemGrants={builtInSystemGrants}
							canReadCatalog={canReadCatalog}
							catalogPending={catalogQuery.isPending}
							filteredCatalog={filteredCatalog}
							formState={formState}
							isCreating={isCreating}
							isDirty={isDirty}
							isEditable={isEditable}
							isOwnerRole={isOwnerRole}
							isPending={rolesQuery.isPending}
							isSaving={isSaving}
							onCancelCreate={() => {
								setMode("view");
								if (selectedRole) {
									setFormState(roleToFormState(selectedRole));
								}
							}}
							onFilterChange={setPermissionFilter}
							onNameChange={(nextName) => {
								setFormState((prev) => ({
									...prev,
									name: nextName,
									slug:
										isCreating && !slugManuallyEdited
											? slugifyRoleInput(nextName)
											: prev.slug,
								}));
							}}
							onSlugChange={(nextSlug) => {
								setSlugManuallyEdited(true);
								setFormState((prev) => ({ ...prev, slug: nextSlug }));
							}}
							onSubmit={handleSubmitForm}
							onTogglePermissions={handleTogglePermissions}
							permissionFilter={permissionFilter}
							selectedPermissionSet={selectedPermissionSet}
							selectedRole={selectedRole}
							setFormState={setFormState}
						/>
					</SettingsSectionContent>
				</SettingsSection>
			</div>

			<CloneRoleDialog
				isPending={cloneRoleMutation.isPending}
				onClone={handleCloneRole}
				onOpenChange={setCloneDialogOpen}
				open={cloneDialogOpen}
				sourceRole={selectedRole}
			/>
		</SettingsPage>
	);
}
