"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
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
import { Play, RefreshCw, Server } from "lucide-react";
import { runAdminAction } from "@/app/admin/_components/admin-table-frame";
import {
	type AdminSystemStatusResponse,
	useAdminSystemStatus,
	useTriggerRetentionSweep,
} from "@/lib/admin-hooks";
import { formatDateTime } from "@/lib/format";

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) {
		return `${days}d ${hours}h ${minutes}m`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m ${seconds % 60}s`;
}

function getHealthVariant(
	status: "degraded" | "healthy" | "unhealthy"
): "destructive" | "success" | "warning" {
	if (status === "healthy") {
		return "success";
	}
	if (status === "degraded") {
		return "warning";
	}
	return "destructive";
}

function getQueueModeVariant(
	queue: AdminSystemStatusResponse["queues"][number]
): "destructive" | "outline" | "secondary" {
	if (queue.error) {
		return "destructive";
	}
	return queue.mode === "redis" ? "secondary" : "outline";
}

function DependenciesGrid({
	data,
	error,
	isError,
	isPending,
	onRetry,
}: {
	data: AdminSystemStatusResponse | undefined;
	error: unknown;
	isError: boolean;
	isPending: boolean;
	onRetry: () => void;
}) {
	if (isError) {
		return (
			<div className="space-y-2 p-6">
				<p className="text-destructive text-sm" role="alert">
					{error instanceof Error
						? error.message
						: "Failed to load system status."}
				</p>
				<Button onClick={onRetry} size="sm" type="button" variant="outline">
					Try again
				</Button>
			</div>
		);
	}

	if (isPending || !data) {
		return (
			<div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
				<Skeleton className="h-24 w-full rounded-lg" />
				<Skeleton className="h-24 w-full rounded-lg" />
				<Skeleton className="h-24 w-full rounded-lg" />
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
			{data.dependencies.map((dep) => (
				<div
					className="border-border bg-card space-y-2 rounded-lg border p-4"
					key={dep.name}
				>
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-2 text-sm font-medium">
							<Server
								aria-hidden="true"
								className="text-muted-foreground size-4"
							/>
							{dep.name}
						</div>
						<Badge variant={getHealthVariant(dep.status)}>{dep.status}</Badge>
					</div>
					<p className="text-muted-foreground text-xs">{dep.detail}</p>
					{dep.latencyMs === null ? null : (
						<p className="text-muted-foreground font-mono text-[11px]">
							Latency: {dep.latencyMs}ms
						</p>
					)}
				</div>
			))}
		</div>
	);
}

export default function AdminSystemPage() {
	const systemQuery = useAdminSystemStatus();
	const triggerRetention = useTriggerRetentionSweep();
	const { data } = systemQuery;

	const handleRunRetention = () =>
		runAdminAction(() => triggerRetention.mutateAsync(), {
			errorFallback: "Failed to trigger retention sweep",
			successMessage: (res) =>
				`Retention sweep enqueued${res.jobId ? ` (job ${res.jobId})` : ""}.`,
		});

	return (
		<SettingsPage
			description="Inspect live runtime dependencies, BullMQ worker queue depths, and run guarded maintenance jobs."
			title="System & Queues"
		>
			<SettingsSection>
				<SettingsSectionHeader
					action={
						<Button
							disabled={systemQuery.isFetching}
							onClick={() => void systemQuery.refetch()}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								aria-hidden="true"
								className={`mr-1.5 size-3.5 ${systemQuery.isFetching ? "animate-spin" : ""}`}
							/>
							Refresh
						</Button>
					}
					description={
						data
							? `Environment: ${data.environment} · Queue driver: ${data.queueDriver} · Uptime: ${formatUptime(data.uptimeSeconds)} · Checked ${formatDateTime(data.checkedAt)}`
							: "Checking live API runtime dependencies..."
					}
					title="Dependencies & Runtime"
				/>

				<DependenciesGrid
					data={data}
					error={systemQuery.error}
					isError={systemQuery.isError}
					isPending={systemQuery.isPending}
					onRetry={() => void systemQuery.refetch()}
				/>
			</SettingsSection>

			<SettingsSection>
				<SettingsSectionHeader
					action={
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									disabled={
										data?.queueDriver !== "redis" || triggerRetention.isPending
									}
									size="sm"
									type="button"
									variant="outline"
								>
									<Play aria-hidden="true" className="mr-1.5 size-3.5" />
									{triggerRetention.isPending
										? "Enqueueing..."
										: "Run Retention Sweep"}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										Trigger data retention cleanup?
									</AlertDialogTitle>
									<AlertDialogDescription>
										This enqueues an immediate retention job on{" "}
										<span className="font-mono">retention-queue</span> to purge
										expired verifications, stale invitations, abandoned pending
										uploads, old read notifications, and expired audit logs
										according to configured retention policies.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction onClick={() => void handleRunRetention()}>
										Enqueue Sweep
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					}
					description="BullMQ queue depths across email, notification, and automated retention workers."
					title="Background Queues"
				/>

				{systemQuery.isPending || !data ? (
					<div className="space-y-2 p-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Queue</TableHead>
									<TableHead>Mode</TableHead>
									<TableHead>Waiting</TableHead>
									<TableHead>Active</TableHead>
									<TableHead>Delayed</TableHead>
									<TableHead>Failed</TableHead>
									<TableHead>Completed</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.queues.map((queue) => (
									<TableRow key={queue.name}>
										<TableCell className="font-mono text-xs font-medium">
											{queue.name}
										</TableCell>
										<TableCell>
											<Badge variant={getQueueModeVariant(queue)}>
												{queue.error ? "error" : queue.mode}
											</Badge>
										</TableCell>
										{queue.counts ? (
											<>
												<TableCell className="font-mono text-xs">
													{queue.counts.waiting}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{queue.counts.active}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{queue.counts.delayed}
												</TableCell>
												<TableCell className="font-mono text-xs">
													<Badge
														variant={
															queue.counts.failed > 0
																? "destructive"
																: "outline"
														}
													>
														{queue.counts.failed}
													</Badge>
												</TableCell>
												<TableCell className="font-mono text-xs">
													{queue.counts.completed}
												</TableCell>
											</>
										) : (
											<TableCell
												className="text-muted-foreground text-xs"
												colSpan={5}
											>
												{queue.error ??
													"Inline mode active — Redis queue stats unavailable."}
											</TableCell>
										)}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</SettingsSection>
		</SettingsPage>
	);
}
