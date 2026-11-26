"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
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
import { useAdminOrganizations } from "@/lib/admin-hooks";
import { formatBytes, formatUtcDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { OrganizationDetailDialog } from "./_components/organization-detail-dialog";

const PAGE_LIMIT = 25;

export default function AdminOrganizationsPage() {
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
	const searchId = useId();

	const debouncedSearch = useDebouncedValue(search, 250);
	const orgsQuery = useAdminOrganizations({
		limit: PAGE_LIMIT,
		page,
		search: debouncedSearch || undefined,
	});
	const items = orgsQuery.data?.items ?? [];

	return (
		<SettingsPage
			description="Inspect tenant workspaces, member rosters, storage usage, and adjust per-organization S3 storage quotas."
			title="Organizations"
		>
			<SettingsSection>
				<SettingsSectionHeader
					action={
						<Button
							disabled={orgsQuery.isFetching}
							onClick={() => void orgsQuery.refetch()}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								aria-hidden="true"
								className={`mr-1.5 size-3.5 ${orgsQuery.isFetching ? "animate-spin" : ""}`}
							/>
							Refresh
						</Button>
					}
					description="Search by workspace name, slug, or organization ID."
					title="Tenant Workspaces"
				/>

				<div className="border-border border-b p-4">
					<div className="max-w-sm space-y-1.5">
						<Label htmlFor={searchId}>Search</Label>
						<div className="relative">
							<Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
							<Input
								className="pl-8"
								id={searchId}
								onChange={(event) => {
									setSearch(event.target.value);
									setPage(1);
								}}
								placeholder="Name, slug, or org_..."
								value={search}
							/>
						</div>
					</div>
				</div>

				<AdminTableFrame
					emptyMessage="No organizations match the current search."
					error={orgsQuery.error}
					errorFallback="Failed to load organizations."
					isEmpty={items.length === 0}
					isError={orgsQuery.isError}
					isPending={orgsQuery.isPending}
					itemLabel="organizations"
					onPageChange={setPage}
					onRetry={() => void orgsQuery.refetch()}
					pagination={orgsQuery.data?.pagination}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Organization</TableHead>
								<TableHead>Members</TableHead>
								<TableHead>Files</TableHead>
								<TableHead>Storage Usage</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="text-right">Manage</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map((org) => {
								const pct =
									org.storageLimit > 0
										? Math.min(
												100,
												Math.round((org.currentUsage / org.storageLimit) * 100)
											)
										: 0;
								return (
									<TableRow key={org.id}>
										<TableCell className="max-w-60">
											<div className="flex flex-col">
												<span className="truncate font-medium">{org.name}</span>
												<span className="text-muted-foreground truncate font-mono text-xs">
													{org.slug}
												</span>
											</div>
										</TableCell>
										<TableCell className="whitespace-nowrap">
											<div className="flex items-center gap-1.5">
												<span className="font-mono text-xs">
													{org.memberCount}
												</span>
												{org.pendingInvitationCount > 0 ? (
													<Badge className="text-[10px]" variant="outline">
														+{org.pendingInvitationCount} pending
													</Badge>
												) : null}
											</div>
										</TableCell>
										<TableCell className="font-mono text-xs">
											{org.fileCount}
										</TableCell>
										<TableCell className="min-w-44">
											<div className="space-y-1">
												<div className="flex items-center justify-between gap-2 font-mono text-[11px]">
													<span>{formatBytes(org.currentUsage)}</span>
													<span className="text-muted-foreground">
														/ {formatBytes(org.storageLimit)}
													</span>
												</div>
												<div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
													<div
														className={
															pct >= 90
																? "bg-destructive h-full"
																: "bg-primary h-full"
														}
														style={{ width: `${pct}%` }}
													/>
												</div>
											</div>
										</TableCell>
										<TableCell className="text-muted-foreground font-mono text-xs whitespace-nowrap">
											{formatUtcDate(org.createdAt)}
										</TableCell>
										<TableCell className="text-right">
											<Button
												aria-label={`Inspect ${org.name}`}
												onClick={() => setSelectedOrgId(org.id)}
												size="sm"
												type="button"
												variant="ghost"
											>
												<Eye className="size-4" />
											</Button>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</AdminTableFrame>
			</SettingsSection>

			<OrganizationDetailDialog
				onClose={() => setSelectedOrgId(null)}
				organizationId={selectedOrgId}
			/>
		</SettingsPage>
	);
}
