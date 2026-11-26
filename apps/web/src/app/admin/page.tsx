"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	SettingsPage,
	SettingsSection,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import {
	Activity,
	ArrowUpRight,
	Building2,
	HardDrive,
	RefreshCw,
	ScrollText,
	ShieldAlert,
	Users,
} from "lucide-react";
import Link from "next/link";
import { DashboardTile } from "@/app/dashboard/_components/dashboard-tile";
import {
	type AdminOverviewResponse,
	useAdminOverview,
} from "@/lib/admin-hooks";
import { formatBytes, formatDateTime } from "@/lib/format";

function MetricCard({
	detail,
	icon: Icon,
	label,
	tone = "default",
	value,
}: {
	detail: string;
	icon: typeof Users;
	label: string;
	tone?: "default" | "warning";
	value: string;
}) {
	return (
		<div className="border-border bg-card rounded-xl border p-4 shadow-2xs">
			<div className="flex items-center justify-between gap-2">
				<span className="text-muted-foreground text-xs font-medium">
					{label}
				</span>
				<Icon
					aria-hidden="true"
					className={
						tone === "warning"
							? "size-4 text-amber-600 dark:text-amber-400"
							: "text-muted-foreground size-4"
					}
				/>
			</div>
			<p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
				{value}
			</p>
			<p className="text-muted-foreground mt-1 text-xs">{detail}</p>
		</div>
	);
}

function MetricsGrid({
	error,
	isError,
	isPending,
	metrics,
}: {
	error: unknown;
	isError: boolean;
	isPending: boolean;
	metrics: AdminOverviewResponse["metrics"] | undefined;
}) {
	if (isError) {
		return (
			<div
				className="border-destructive/40 bg-destructive/5 rounded-xl border p-4 text-sm"
				role="alert"
			>
				<p className="text-destructive">
					{error instanceof Error
						? error.message
						: "Failed to load platform metrics."}
				</p>
			</div>
		);
	}

	if (isPending || !metrics) {
		return (
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Skeleton className="h-28 w-full rounded-xl" />
				<Skeleton className="h-28 w-full rounded-xl" />
				<Skeleton className="h-28 w-full rounded-xl" />
				<Skeleton className="h-28 w-full rounded-xl" />
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<MetricCard
				detail={`${metrics.verifiedUsers} verified · ${metrics.twoFactorAdoptionPercent}% 2FA · ${metrics.platformAdmins} admins`}
				icon={Users}
				label="Total Users"
				value={metrics.totalUsers.toLocaleString()}
			/>
			<MetricCard
				detail={`${metrics.activeSessions.toLocaleString()} active sessions · ${metrics.bannedUsers} banned`}
				icon={Building2}
				label="Organizations"
				value={metrics.totalOrganizations.toLocaleString()}
			/>
			<MetricCard
				detail={`${formatBytes(metrics.totalStorageLimitBytes)} allocated · ${metrics.committedFiles.toLocaleString()} files`}
				icon={HardDrive}
				label="Storage Used"
				value={formatBytes(metrics.totalStorageUsedBytes)}
			/>
			<MetricCard
				detail={`${metrics.securityEvents24h.toLocaleString()} security denials in 24h`}
				icon={ShieldAlert}
				label="Audit Events (24h)"
				tone={metrics.securityEvents24h > 0 ? "warning" : "default"}
				value={metrics.auditEvents24h.toLocaleString()}
			/>
		</div>
	);
}

function RecentEventsTable({
	events,
	isPending,
}: {
	events: AdminOverviewResponse["recentEvents"];
	isPending: boolean;
}) {
	if (isPending) {
		return (
			<div className="space-y-2 p-4">
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-full" />
			</div>
		);
	}

	if (events.length === 0) {
		return (
			<p className="text-muted-foreground p-6 text-center text-sm">
				No recent audit events recorded yet.
			</p>
		);
	}

	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Time</TableHead>
						<TableHead>Tenant</TableHead>
						<TableHead>Actor</TableHead>
						<TableHead>Action</TableHead>
						<TableHead>Status</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{events.map((entry) => {
						const status = entry.details?.status;
						return (
							<TableRow key={entry.id}>
								<TableCell className="text-muted-foreground font-mono text-xs whitespace-nowrap">
									{formatDateTime(entry.createdAt)}
								</TableCell>
								<TableCell>
									<Badge
										className="text-[11px]"
										variant={entry.organizationId ? "outline" : "secondary"}
									>
										{entry.organizationName || entry.organizationId || "Global"}
									</Badge>
								</TableCell>
								<TableCell className="max-w-48 truncate text-xs">
									{entry.actorEmail ||
										entry.actorName ||
										entry.userId ||
										"System"}
								</TableCell>
								<TableCell>
									<Badge
										className="font-mono text-xs"
										variant={
											entry.action.startsWith("security.")
												? "destructive"
												: "secondary"
										}
									>
										{entry.action}
									</Badge>
								</TableCell>
								<TableCell>
									<Badge
										variant={
											typeof status === "number" && status >= 400
												? "destructive"
												: "outline"
										}
									>
										{status ?? "—"}
									</Badge>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}

export default function AdminOverviewPage() {
	const overviewQuery = useAdminOverview();

	return (
		<SettingsPage
			description="Internal operator console scoped to platform administrators (user.role = admin). Tenant workspace owners and admins cannot access these routes."
			title="Platform Backoffice"
		>
			<section aria-label="Platform metrics" className="space-y-3">
				<div className="flex items-center justify-between gap-2">
					<h2 className="text-sm font-semibold">Live Platform Snapshot</h2>
					<Button
						disabled={overviewQuery.isFetching}
						onClick={() => void overviewQuery.refetch()}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCw
							aria-hidden="true"
							className={`mr-1.5 size-3.5 ${overviewQuery.isFetching ? "animate-spin" : ""}`}
						/>
						Refresh
					</Button>
				</div>

				<MetricsGrid
					error={overviewQuery.error}
					isError={overviewQuery.isError}
					isPending={overviewQuery.isPending}
					metrics={overviewQuery.data?.metrics}
				/>
			</section>

			<div className="grid grid-cols-1 gap-5 md:grid-cols-2">
				<DashboardTile
					badge="Support"
					description="Search accounts, enforce bans, manage platform admin roles, revoke active sessions, and run audited user impersonation."
					href="/admin/users"
					icon={Users}
					title="Users & Impersonation"
				/>
				<DashboardTile
					badge="Tenants"
					description="Inspect customer workspaces, member rosters, pending invitations, and adjust per-organization S3 storage quotas."
					href="/admin/organizations"
					icon={Building2}
					title="Organizations & Quotas"
				/>
				<DashboardTile
					badge="ISO 27001"
					description="Inspect cross-tenant and global append-only audit logs, security denials, impersonation trails, and export CSV/JSON evidence."
					href="/admin/audit"
					icon={ScrollText}
					title="System Audit Logs"
				/>
				<DashboardTile
					badge="Ops"
					description="Verify PostgreSQL, Redis, and S3 health, monitor BullMQ queue depths, and trigger on-demand data retention sweeps."
					href="/admin/system"
					icon={Activity}
					title="System & Queues"
				/>
			</div>

			<SettingsSection>
				<SettingsSectionHeader
					action={
						<Button asChild size="sm" variant="outline">
							<Link href="/admin/audit">
								View all logs
								<ArrowUpRight aria-hidden="true" className="ml-1 size-3.5" />
							</Link>
						</Button>
					}
					description="Latest 8 entries from the append-only platform audit trail."
					title="Recent Activity"
				/>

				<RecentEventsTable
					events={overviewQuery.data?.recentEvents ?? []}
					isPending={overviewQuery.isPending}
				/>
			</SettingsSection>
		</SettingsPage>
	);
}
