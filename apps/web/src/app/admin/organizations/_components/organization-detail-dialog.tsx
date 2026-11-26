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
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { HardDrive, ScrollText } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { runAdminAction } from "@/app/admin/_components/admin-table-frame";
import {
	type AdminOrganizationDetailResponse,
	useAdminOrganizationDetail,
	useUpdateAdminOrganizationStorageLimit,
} from "@/lib/admin-hooks";
import { formatBytes, formatDateTime } from "@/lib/format";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const MAX_STORAGE_LIMIT_MB = 10 * 1024 * 1024; // 10 TB

const QUOTA_PRESETS = [
	{ bytes: 1 * GB, label: "1 GB" },
	{ bytes: 5 * GB, label: "5 GB" },
	{ bytes: 10 * GB, label: "10 GB" },
	{ bytes: 50 * GB, label: "50 GB" },
	{ bytes: 100 * GB, label: "100 GB" },
] as const;

function StorageQuotaEditor({
	isSaving,
	onSave,
	storage,
}: {
	isSaving: boolean;
	onSave: (bytes: number) => Promise<void>;
	storage: AdminOrganizationDetailResponse["storage"];
}) {
	const [limitMbInput, setLimitMbInput] = useState(() =>
		String(Math.round(storage.storageLimit / MB))
	);
	const quotaInputId = useId();

	useEffect(() => {
		setLimitMbInput(String(Math.round(storage.storageLimit / MB)));
	}, [storage.storageLimit]);

	const usagePercent =
		storage.storageLimit > 0
			? Math.min(
					100,
					Math.round((storage.currentUsage / storage.storageLimit) * 100)
				)
			: 0;

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		const parsedMb = Number(limitMbInput.trim());
		if (
			!Number.isFinite(parsedMb) ||
			parsedMb < 10 ||
			parsedMb > MAX_STORAGE_LIMIT_MB
		) {
			toast.error("Storage limit must be between 10 MB and 10 TB.");
			return;
		}
		await onSave(Math.round(parsedMb * MB));
	};

	return (
		<div className="border-border space-y-3 rounded-lg border p-4">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 font-medium">
					<HardDrive
						aria-hidden="true"
						className="text-muted-foreground size-4"
					/>
					Storage Quota
				</div>
				<span className="font-mono text-xs">
					{formatBytes(storage.currentUsage)} /{" "}
					{formatBytes(storage.storageLimit)} ({usagePercent}%)
				</span>
			</div>

			<div className="bg-muted h-2 w-full overflow-hidden rounded-full">
				<div
					className={
						usagePercent >= 90
							? "bg-destructive h-full transition-all"
							: "bg-primary h-full transition-all"
					}
					style={{ width: `${usagePercent}%` }}
				/>
			</div>

			<p className="text-muted-foreground text-xs">
				{storage.fileCount.toLocaleString()} committed file(s)
			</p>

			<div className="flex flex-wrap gap-1.5">
				{QUOTA_PRESETS.map((preset) => (
					<Button
						disabled={isSaving}
						key={preset.label}
						onClick={() => void onSave(preset.bytes)}
						size="sm"
						type="button"
						variant={
							storage.storageLimit === preset.bytes ? "secondary" : "outline"
						}
					>
						{preset.label}
					</Button>
				))}
			</div>

			<form
				className="flex flex-wrap items-end gap-2 pt-1"
				onSubmit={(event) => void handleSubmit(event)}
			>
				<div className="flex-1 space-y-1">
					<Label className="text-xs" htmlFor={quotaInputId}>
						Custom limit (MB)
					</Label>
					<Input
						id={quotaInputId}
						max={MAX_STORAGE_LIMIT_MB}
						min={10}
						onChange={(event) => setLimitMbInput(event.target.value)}
						type="number"
						value={limitMbInput}
					/>
				</div>
				<Button disabled={isSaving} size="sm" type="submit">
					{isSaving ? "Saving..." : "Update Quota"}
				</Button>
			</form>
		</div>
	);
}

function OrganizationDetailBody({
	data,
	error,
	isError,
	isPending,
	isSavingQuota,
	onClose,
	onSaveQuota,
}: {
	data: AdminOrganizationDetailResponse | undefined;
	error: unknown;
	isError: boolean;
	isPending: boolean;
	isSavingQuota: boolean;
	onClose: () => void;
	onSaveQuota: (bytes: number) => Promise<void>;
}) {
	if (isError) {
		return (
			<p className="text-destructive text-sm" role="alert">
				{error instanceof Error
					? error.message
					: "Failed to load organization details."}
			</p>
		);
	}

	if (isPending || !data) {
		return (
			<div className="space-y-3">
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-28 w-full" />
			</div>
		);
	}

	const { members, organization: org, pendingInvitations, storage } = data;

	return (
		<div className="space-y-5 text-sm">
			<div className="flex justify-end">
				<Button asChild size="sm" variant="outline">
					<Link
						href={`/admin/audit?organizationId=${encodeURIComponent(org.id)}`}
						onClick={onClose}
					>
						<ScrollText aria-hidden="true" className="mr-1.5 size-3.5" />
						View Organization Audit Trail
					</Link>
				</Button>
			</div>

			<StorageQuotaEditor
				isSaving={isSavingQuota}
				key={org.id}
				onSave={onSaveQuota}
				storage={storage}
			/>

			<div className="space-y-2">
				<h3 className="text-xs font-semibold tracking-wide uppercase">
					Members ({members.length})
				</h3>
				{members.length === 0 ? (
					<p className="text-muted-foreground text-xs">No members.</p>
				) : (
					<div className="divide-border border-border divide-y rounded-lg border">
						{members.map((member) => (
							<div
								className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
								key={member.memberId}
							>
								<div className="min-w-0">
									<p className="truncate font-medium">{member.name}</p>
									<p className="text-muted-foreground truncate text-[11px]">
										{member.email}
									</p>
								</div>
								<div className="flex items-center gap-1.5">
									{member.banned ? (
										<Badge variant="destructive">Banned</Badge>
									) : null}
									{member.twoFactorEnabled ? (
										<Badge variant="success">2FA</Badge>
									) : null}
									<Badge className="capitalize" variant="outline">
										{member.role}
									</Badge>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			<div className="space-y-2">
				<h3 className="text-xs font-semibold tracking-wide uppercase">
					Pending Invitations ({pendingInvitations.length})
				</h3>
				{pendingInvitations.length === 0 ? (
					<p className="text-muted-foreground text-xs">
						No pending invitations.
					</p>
				) : (
					<div className="divide-border border-border divide-y rounded-lg border">
						{pendingInvitations.map((invite) => (
							<div
								className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
								key={invite.id}
							>
								<div className="min-w-0">
									<p className="truncate font-medium">{invite.email}</p>
									<p className="text-muted-foreground text-[11px]">
										Expires {formatDateTime(invite.expiresAt)}
									</p>
								</div>
								<Badge className="capitalize" variant="outline">
									{invite.role}
								</Badge>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

export function OrganizationDetailDialog({
	onClose,
	organizationId,
}: {
	onClose: () => void;
	organizationId: string | null;
}) {
	const detailQuery = useAdminOrganizationDetail(organizationId);
	const updateLimit = useUpdateAdminOrganizationStorageLimit();
	const org = detailQuery.data?.organization;

	const handleSaveQuota = async (bytes: number) => {
		if (!org) {
			return;
		}
		await runAdminAction(
			() =>
				updateLimit.mutateAsync({
					organizationId: org.id,
					storageLimitBytes: bytes,
				}),
			{
				errorFallback: "Failed to update storage quota",
				successMessage: `Storage quota updated to ${formatBytes(bytes)}.`,
			}
		);
	};

	const descriptionText = org
		? `${org.slug ?? "no-slug"} · ${org.id}`
		: (organizationId ?? "");

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={organizationId !== null}
		>
			<DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{org?.name || "Organization Details"}</DialogTitle>
					<DialogDescription className="font-mono text-xs">
						{descriptionText}
					</DialogDescription>
				</DialogHeader>

				<OrganizationDetailBody
					data={detailQuery.data}
					error={detailQuery.error}
					isError={detailQuery.isError}
					isPending={detailQuery.isPending}
					isSavingQuota={updateLimit.isPending}
					onClose={onClose}
					onSaveQuota={handleSaveQuota}
				/>
			</DialogContent>
		</Dialog>
	);
}
