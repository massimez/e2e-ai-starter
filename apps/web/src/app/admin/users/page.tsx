"use client";

import { isPlatformAdminRole } from "@workspace/shared/permissions";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
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
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { Eye, RefreshCw, Search } from "lucide-react";
import { useId, useState } from "react";
import { AdminTableFrame } from "@/app/admin/_components/admin-table-frame";
import { type AdminUserListItem, useAdminUsers } from "@/lib/admin-hooks";
import { formatUtcDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { UserDetailDialog } from "./_components/user-detail-dialog";

const PAGE_LIMIT = 25;

interface UserFilterState {
	page: number;
	role: "all" | "admin" | "user";
	search: string;
	status: "all" | "active" | "banned";
	twoFactor: "all" | "enabled" | "disabled";
}

const DEFAULT_FILTERS: UserFilterState = {
	page: 1,
	role: "all",
	search: "",
	status: "all",
	twoFactor: "all",
};

function UserStatusBadge({
	banned,
	emailVerified,
}: {
	banned: boolean;
	emailVerified: boolean;
}) {
	if (banned) {
		return <Badge variant="destructive">Banned</Badge>;
	}
	if (emailVerified) {
		return <Badge variant="success">Active</Badge>;
	}
	return <Badge variant="outline">Unverified</Badge>;
}

function UsersTableRow({
	entry,
	onManage,
}: {
	entry: AdminUserListItem;
	onManage: (userId: string) => void;
}) {
	const isAdmin = isPlatformAdminRole(entry.role);
	return (
		<TableRow>
			<TableCell className="max-w-60">
				<div className="flex flex-col">
					<span className="truncate font-medium">{entry.name}</span>
					<span className="text-muted-foreground truncate text-xs">
						{entry.email}
					</span>
				</div>
			</TableCell>
			<TableCell>
				<Badge variant={isAdmin ? "warning" : "secondary"}>
					{isAdmin ? "Admin" : "User"}
				</Badge>
			</TableCell>
			<TableCell>
				<UserStatusBadge
					banned={entry.banned}
					emailVerified={entry.emailVerified}
				/>
			</TableCell>
			<TableCell>
				<Badge variant={entry.twoFactorEnabled ? "success" : "outline"}>
					{entry.twoFactorEnabled ? "On" : "Off"}
				</Badge>
			</TableCell>
			<TableCell className="font-mono text-xs">
				{entry.organizationCount}
			</TableCell>
			<TableCell className="font-mono text-xs">
				{entry.activeSessionCount}
			</TableCell>
			<TableCell className="text-muted-foreground font-mono text-xs whitespace-nowrap">
				{formatUtcDate(entry.createdAt)}
			</TableCell>
			<TableCell className="text-right">
				<Button
					aria-label={`Manage ${entry.email}`}
					onClick={() => onManage(entry.id)}
					size="sm"
					type="button"
					variant="ghost"
				>
					<Eye className="size-4" />
				</Button>
			</TableCell>
		</TableRow>
	);
}

export default function AdminUsersPage() {
	const [filters, setFilters] = useState<UserFilterState>(DEFAULT_FILTERS);
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

	const searchId = useId();
	const roleId = useId();
	const statusId = useId();
	const twoFactorId = useId();

	const updateFilters = (patch: Partial<UserFilterState>) => {
		setFilters((prev) => ({
			...prev,
			...patch,
			page: patch.page ?? 1,
		}));
	};

	const debouncedSearch = useDebouncedValue(filters.search, 250);
	const usersQuery = useAdminUsers({
		limit: PAGE_LIMIT,
		page: filters.page,
		role: filters.role,
		search: debouncedSearch || undefined,
		status: filters.status,
		twoFactor: filters.twoFactor,
	});
	const items = usersQuery.data?.items ?? [];

	return (
		<SettingsPage
			description="Manage platform user accounts, security posture (2FA, sessions), bans, roles, and audited customer impersonation."
			title="Users"
		>
			<SettingsSection>
				<SettingsSectionHeader
					action={
						<Button
							disabled={usersQuery.isFetching}
							onClick={() => void usersQuery.refetch()}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								aria-hidden="true"
								className={`mr-1.5 size-3.5 ${usersQuery.isFetching ? "animate-spin" : ""}`}
							/>
							Refresh
						</Button>
					}
					description="Search by name, email, or user ID and inspect individual accounts to manage sessions, bans, or impersonation."
					title="Platform User Directory"
				/>

				<div className="border-border grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
					<div className="space-y-1.5">
						<Label htmlFor={searchId}>Search</Label>
						<div className="relative">
							<Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
							<Input
								className="pl-8"
								id={searchId}
								onChange={(event) =>
									updateFilters({ search: event.target.value })
								}
								placeholder="Name, email, or ID..."
								value={filters.search}
							/>
						</div>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={roleId}>Platform Role</Label>
						<Select
							onValueChange={(value) =>
								updateFilters({ role: value as UserFilterState["role"] })
							}
							value={filters.role}
						>
							<SelectTrigger id={roleId}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All roles</SelectItem>
								<SelectItem value="admin">Platform admins</SelectItem>
								<SelectItem value="user">Standard users</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={statusId}>Account Status</Label>
						<Select
							onValueChange={(value) =>
								updateFilters({ status: value as UserFilterState["status"] })
							}
							value={filters.status}
						>
							<SelectTrigger id={statusId}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All statuses</SelectItem>
								<SelectItem value="active">Active</SelectItem>
								<SelectItem value="banned">Banned</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={twoFactorId}>2FA Status</Label>
						<Select
							onValueChange={(value) =>
								updateFilters({
									twoFactor: value as UserFilterState["twoFactor"],
								})
							}
							value={filters.twoFactor}
						>
							<SelectTrigger id={twoFactorId}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All</SelectItem>
								<SelectItem value="enabled">2FA enabled</SelectItem>
								<SelectItem value="disabled">2FA off</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>

				<AdminTableFrame
					emptyMessage="No users match the current filters."
					error={usersQuery.error}
					errorFallback="Failed to load users."
					isEmpty={items.length === 0}
					isError={usersQuery.isError}
					isPending={usersQuery.isPending}
					itemLabel="users"
					onPageChange={(nextPage) => updateFilters({ page: nextPage })}
					onRetry={() => void usersQuery.refetch()}
					pagination={usersQuery.data?.pagination}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>User</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>2FA</TableHead>
								<TableHead>Orgs</TableHead>
								<TableHead>Sessions</TableHead>
								<TableHead>Joined</TableHead>
								<TableHead className="text-right">Manage</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map((entry) => (
								<UsersTableRow
									entry={entry}
									key={entry.id}
									onManage={setSelectedUserId}
								/>
							))}
						</TableBody>
					</Table>
				</AdminTableFrame>
			</SettingsSection>

			<UserDetailDialog
				onClose={() => setSelectedUserId(null)}
				userId={selectedUserId}
			/>
		</SettingsPage>
	);
}
