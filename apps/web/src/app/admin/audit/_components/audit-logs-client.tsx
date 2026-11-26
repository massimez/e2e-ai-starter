"use client";

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
import { Download, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { runAdminAction } from "@/app/admin/_components/admin-table-frame";
import {
	type AuditLogEntry,
	type AuditScopeFilter,
	exportAdminAuditLogs,
	useAdminAuditLogs,
} from "@/lib/admin-hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { AuditDetailDialog, AuditTable } from "./audit-table";

const PAGE_LIMIT = 25;

interface AuditFilterState {
	action: string;
	from: string;
	organizationId: string;
	page: number;
	scope: AuditScopeFilter;
	search: string;
	to: string;
	userId: string;
}

const DEFAULT_FILTERS: AuditFilterState = {
	action: "",
	from: "",
	organizationId: "",
	page: 1,
	scope: "all",
	search: "",
	to: "",
	userId: "",
};

export function AdminAuditLogsClient({
	initialOrganizationId = "",
	initialUserId = "",
}: {
	initialOrganizationId?: string;
	initialUserId?: string;
}) {
	const router = useRouter();
	const [filters, setFilters] = useState<AuditFilterState>(() => ({
		...DEFAULT_FILTERS,
		organizationId: initialOrganizationId,
		scope: initialOrganizationId ? "organization" : "all",
		userId: initialUserId,
	}));
	const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(
		null
	);
	const [exportingFormat, setExportingFormat] = useState<"csv" | "json" | null>(
		null
	);

	const scopeId = useId();
	const orgId = useId();
	const userIdInputId = useId();
	const searchId = useId();
	const actionId = useId();
	const fromId = useId();
	const toId = useId();

	const updateFilters = (patch: Partial<AuditFilterState>) => {
		setFilters((prev) => ({
			...prev,
			...patch,
			page: patch.page ?? 1,
		}));
	};

	const debouncedAction = useDebouncedValue(filters.action, 250);
	const debouncedOrgId = useDebouncedValue(filters.organizationId, 250);
	const debouncedSearch = useDebouncedValue(filters.search, 250);
	const debouncedUserId = useDebouncedValue(filters.userId, 250);

	const hasInvalidDateRange = Boolean(
		filters.from && filters.to && filters.from > filters.to
	);

	const queryFilters = {
		action: debouncedAction || undefined,
		from: filters.from || undefined,
		organizationId:
			filters.scope === "global" ? undefined : debouncedOrgId || undefined,
		scope: filters.scope,
		search: debouncedSearch || undefined,
		to: filters.to || undefined,
		userId: debouncedUserId || undefined,
	};

	const auditQuery = useAdminAuditLogs(
		{
			...queryFilters,
			limit: PAGE_LIMIT,
			page: filters.page,
		},
		!hasInvalidDateRange
	);

	const handleReset = () => {
		setFilters(DEFAULT_FILTERS);
		if (initialOrganizationId || initialUserId) {
			router.replace("/admin/audit");
		}
	};

	const handleExport = async (format: "csv" | "json") => {
		setExportingFormat(format);
		try {
			await runAdminAction(
				() => exportAdminAuditLogs({ filters: queryFilters, format }),
				{
					errorFallback: "Failed to export audit logs",
					successMessage: ({ filename }) => `Exported ${filename}`,
				}
			);
		} finally {
			setExportingFormat(null);
		}
	};

	const hasActiveFilters = Boolean(
		filters.scope !== "all" ||
			filters.organizationId ||
			filters.userId ||
			filters.search ||
			filters.action ||
			filters.from ||
			filters.to
	);

	return (
		<SettingsPage
			description="Platform-wide append-only audit trail across all workspaces and global authentication/security events."
			title="System Audit Logs"
		>
			<SettingsSection>
				<SettingsSectionHeader
					action={
						<div className="flex flex-wrap items-center gap-2">
							<Button
								disabled={auditQuery.isFetching}
								onClick={() => void auditQuery.refetch()}
								size="sm"
								type="button"
								variant="outline"
							>
								<RefreshCw
									className={`mr-1.5 size-3.5 ${auditQuery.isFetching ? "animate-spin" : ""}`}
								/>
								Refresh
							</Button>
							<Button
								disabled={exportingFormat !== null}
								onClick={() => void handleExport("csv")}
								size="sm"
								type="button"
								variant="outline"
							>
								<Download className="mr-1.5 size-3.5" />
								{exportingFormat === "csv" ? "Exporting..." : "Export CSV"}
							</Button>
							<Button
								disabled={exportingFormat !== null}
								onClick={() => void handleExport("json")}
								size="sm"
								type="button"
								variant="outline"
							>
								<Download className="mr-1.5 size-3.5" />
								{exportingFormat === "json" ? "Exporting..." : "Export JSON"}
							</Button>
						</div>
					}
					description="Filter by scope (global vs organization), tenant ID, user ID, actor, action prefix, IP address, or date range."
					title="Backoffice Activity Trail"
				/>

				<div className="border-border grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
					<div className="space-y-1.5">
						<Label htmlFor={scopeId}>Scope</Label>
						<Select
							onValueChange={(value) =>
								updateFilters({ scope: value as AuditScopeFilter })
							}
							value={filters.scope}
						>
							<SelectTrigger id={scopeId}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">
									All events (global + tenants)
								</SelectItem>
								<SelectItem value="global">Global / pre-org only</SelectItem>
								<SelectItem value="organization">Tenant events only</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={orgId}>Organization ID</Label>
						<Input
							disabled={filters.scope === "global"}
							id={orgId}
							onChange={(event) =>
								updateFilters({ organizationId: event.target.value })
							}
							placeholder="Filter by org_..."
							value={filters.organizationId}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={userIdInputId}>User ID</Label>
						<Input
							id={userIdInputId}
							onChange={(event) =>
								updateFilters({ userId: event.target.value })
							}
							placeholder="Filter by user ID..."
							value={filters.userId}
						/>
					</div>
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
								placeholder="Email, org, entity, IP..."
								value={filters.search}
							/>
						</div>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={actionId}>Action prefix</Label>
						<Input
							id={actionId}
							onChange={(event) =>
								updateFilters({ action: event.target.value })
							}
							placeholder="e.g. security. or app.storage"
							value={filters.action}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={fromId}>From date</Label>
						<Input
							id={fromId}
							onChange={(event) => updateFilters({ from: event.target.value })}
							type="date"
							value={filters.from}
						/>
					</div>
					<div className="space-y-1.5 sm:col-span-2">
						<Label htmlFor={toId}>To date</Label>
						<div className="flex gap-2">
							<Input
								id={toId}
								onChange={(event) => updateFilters({ to: event.target.value })}
								type="date"
								value={filters.to}
							/>
							{hasActiveFilters ? (
								<Button
									onClick={handleReset}
									size="sm"
									type="button"
									variant="ghost"
								>
									Reset
								</Button>
							) : null}
						</div>
					</div>
					{hasInvalidDateRange ? (
						<p
							className="text-destructive text-xs sm:col-span-2 lg:col-span-4"
							role="alert"
						>
							&ldquo;From date&rdquo; must be earlier than or equal to &ldquo;To
							date&rdquo;.
						</p>
					) : null}
				</div>

				<AuditTable
					error={auditQuery.error}
					isError={auditQuery.isError}
					isPending={auditQuery.isPending}
					items={auditQuery.data?.items ?? []}
					onInspect={setSelectedEntry}
					onPageChange={(nextPage) => updateFilters({ page: nextPage })}
					onRetry={() => void auditQuery.refetch()}
					pagination={auditQuery.data?.pagination}
				/>
			</SettingsSection>

			<AuditDetailDialog
				entry={selectedEntry}
				onClose={() => setSelectedEntry(null)}
			/>
		</SettingsPage>
	);
}
