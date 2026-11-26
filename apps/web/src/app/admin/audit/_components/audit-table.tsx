"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { Eye } from "lucide-react";
import { AdminTableFrame } from "@/app/admin/_components/admin-table-frame";
import type { AuditLogEntry, AuditLogsPageResponse } from "@/lib/admin-hooks";
import { formatDateTime } from "@/lib/format";

function getStatusVariant(
	status: number | undefined
): "destructive" | "outline" | "secondary" | "success" {
	if (!status) {
		return "outline";
	}
	if (status >= 400) {
		return "destructive";
	}
	if (status >= 200 && status < 300) {
		return "success";
	}
	return "outline";
}

function AuditTableRow({
	entry,
	onInspect,
}: {
	entry: AuditLogEntry;
	onInspect: (entry: AuditLogEntry) => void;
}) {
	const timestamp = new Date(entry.createdAt);
	const status = entry.details?.status;
	const durationMs = entry.details?.durationMs;
	const impersonatedBy = entry.details?.impersonatedBy;
	const actorLabel =
		entry.actorName || entry.actorEmail || entry.userId || "System / Anonymous";
	const tenantLabel = entry.organizationId
		? entry.organizationName || entry.organizationId
		: "Global";

	return (
		<TableRow>
			<TableCell className="text-muted-foreground font-mono text-xs whitespace-nowrap">
				<time dateTime={timestamp.toISOString()}>
					{formatDateTime(timestamp)}
				</time>
			</TableCell>
			<TableCell className="max-w-36">
				<Badge
					className="max-w-full truncate text-[11px]"
					title={entry.organizationId ?? "Global"}
					variant={entry.organizationId ? "outline" : "secondary"}
				>
					{tenantLabel}
				</Badge>
			</TableCell>
			<TableCell className="max-w-44">
				<div className="flex flex-col gap-0.5">
					<span className="truncate text-xs font-medium">{actorLabel}</span>
					{entry.actorEmail && entry.actorName ? (
						<span className="text-muted-foreground truncate text-[11px]">
							{entry.actorEmail}
						</span>
					) : null}
					{impersonatedBy ? (
						<Badge className="mt-0.5 w-fit text-[10px]" variant="destructive">
							Impersonated
						</Badge>
					) : null}
				</div>
			</TableCell>
			<TableCell className="max-w-60">
				<div className="flex flex-col gap-0.5">
					<Badge
						className="w-fit max-w-full truncate font-mono text-[11px]"
						variant={
							entry.action.startsWith("security.") ? "destructive" : "secondary"
						}
					>
						{entry.action}
					</Badge>
					{entry.entityType ? (
						<span className="text-muted-foreground truncate font-mono text-[11px]">
							{entry.entityType}
							{entry.entityId ? ` · ${entry.entityId}` : ""}
						</span>
					) : null}
				</div>
			</TableCell>
			<TableCell className="text-muted-foreground font-mono text-xs whitespace-nowrap">
				{entry.ipAddress ?? "—"}
			</TableCell>
			<TableCell className="whitespace-nowrap">
				<div className="flex items-center gap-1.5">
					<Badge variant={getStatusVariant(status)}>{status ?? "—"}</Badge>
					{typeof durationMs === "number" ? (
						<span className="text-muted-foreground font-mono text-[11px]">
							{durationMs}ms
						</span>
					) : null}
				</div>
			</TableCell>
			<TableCell className="text-right">
				<Button
					aria-label={`Inspect audit event ${entry.action}`}
					onClick={() => onInspect(entry)}
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

export function AuditTable({
	error,
	isError,
	isPending,
	items,
	onInspect,
	onPageChange,
	onRetry,
	pagination,
}: {
	error: unknown;
	isError: boolean;
	isPending: boolean;
	items: AuditLogEntry[];
	onInspect: (entry: AuditLogEntry) => void;
	onPageChange: (nextPage: number) => void;
	onRetry: () => void;
	pagination: AuditLogsPageResponse["pagination"] | undefined;
}) {
	return (
		<AdminTableFrame
			emptyMessage="No audit events match the current filters."
			error={error}
			errorFallback="Failed to load audit logs."
			isEmpty={items.length === 0}
			isError={isError}
			isPending={isPending}
			itemLabel="events"
			onPageChange={onPageChange}
			onRetry={onRetry}
			pagination={pagination}
		>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Time</TableHead>
						<TableHead>Tenant</TableHead>
						<TableHead>Actor</TableHead>
						<TableHead>Event</TableHead>
						<TableHead>IP</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Details</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{items.map((entry) => (
						<AuditTableRow entry={entry} key={entry.id} onInspect={onInspect} />
					))}
				</TableBody>
			</Table>
		</AdminTableFrame>
	);
}

export function AuditDetailDialog({
	entry,
	onClose,
}: {
	entry: AuditLogEntry | null;
	onClose: () => void;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={entry !== null}
		>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle className="font-mono text-base">
						{entry?.action}
					</DialogTitle>
					<DialogDescription>Event ID: {entry?.id}</DialogDescription>
				</DialogHeader>
				{entry ? (
					<div className="space-y-3 text-xs">
						<div className="grid grid-cols-2 gap-2">
							<div>
								<span className="text-muted-foreground block">Timestamp</span>
								<span className="font-mono">
									{new Date(entry.createdAt).toISOString()}
								</span>
							</div>
							<div>
								<span className="text-muted-foreground block">Tenant</span>
								<span className="font-mono">
									{entry.organizationId
										? `${entry.organizationName ?? ""} (${entry.organizationId})`.trim()
										: "Global (no organization)"}
								</span>
							</div>
							<div>
								<span className="text-muted-foreground block">Actor</span>
								<span>{entry.actorEmail || entry.userId || "System"}</span>
							</div>
							<div>
								<span className="text-muted-foreground block">IP Address</span>
								<span className="font-mono">{entry.ipAddress ?? "—"}</span>
							</div>
							{entry.details?.impersonatedBy ? (
								<div className="col-span-2">
									<span className="text-muted-foreground block">
										Impersonated By
									</span>
									<span className="font-mono">
										{entry.details.impersonatedBy}
									</span>
								</div>
							) : null}
							<div className="col-span-2">
								<span className="text-muted-foreground block">User Agent</span>
								<span className="block truncate">{entry.userAgent ?? "—"}</span>
							</div>
						</div>
						<div>
							<span className="text-muted-foreground mb-1 block">
								Structured Details
							</span>
							<pre className="bg-muted max-h-72 overflow-auto rounded-md p-3 font-mono text-xs">
								{JSON.stringify(entry.details ?? {}, null, 2)}
							</pre>
						</div>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
