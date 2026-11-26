"use client";

import { useQueryClient } from "@tanstack/react-query";
import { isPlatformAdminRole } from "@workspace/shared/permissions";
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
import { Textarea } from "@workspace/ui/components/textarea";
import {
	Ban,
	LogOut,
	ScrollText,
	ShieldCheck,
	ShieldOff,
	UserCheck,
	UserCog,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { runAdminAction } from "@/app/admin/_components/admin-table-frame";
import {
	type AdminUserDetailResponse,
	useAdminUserDetail,
	useBanAdminUser,
	useRevokeAdminUserSession,
	useRevokeAllAdminUserSessions,
	useUnbanAdminUser,
	useUpdateAdminUserRole,
} from "@/lib/admin-hooks";
import { authClient, useSession } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";

function UserBanForm({
	isPending,
	onCancel,
	onSubmit,
}: {
	isPending: boolean;
	onCancel: () => void;
	onSubmit: (params: {
		expiresInDays?: number;
		reason: string;
	}) => Promise<void>;
}) {
	const [reason, setReason] = useState("");
	const [days, setDays] = useState("");
	const banReasonId = useId();
	const banDaysId = useId();

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		const trimmedReason = reason.trim();
		if (trimmedReason.length < 3) {
			toast.error("Please enter a ban reason (at least 3 characters).");
			return;
		}
		const parsedDays = days.trim() ? Number(days.trim()) : undefined;
		if (
			parsedDays !== undefined &&
			(!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 3650)
		) {
			toast.error("Expiry days must be a whole number between 1 and 3650.");
			return;
		}
		await onSubmit({ expiresInDays: parsedDays, reason: trimmedReason });
		setReason("");
		setDays("");
	};

	return (
		<form
			className="border-destructive/40 bg-destructive/5 space-y-3 rounded-lg border p-3"
			onSubmit={(event) => void handleSubmit(event)}
		>
			<div className="space-y-1">
				<Label htmlFor={banReasonId}>Ban Reason (required)</Label>
				<Textarea
					id={banReasonId}
					onChange={(event) => setReason(event.target.value)}
					placeholder="Describe the policy violation or security incident..."
					required
					rows={2}
					value={reason}
				/>
			</div>
			<div className="space-y-1">
				<Label htmlFor={banDaysId}>
					Duration in days (leave blank for permanent)
				</Label>
				<Input
					id={banDaysId}
					max={3650}
					min={1}
					onChange={(event) => setDays(event.target.value)}
					placeholder="e.g. 30"
					type="number"
					value={days}
				/>
			</div>
			<div className="flex justify-end gap-2">
				<Button onClick={onCancel} size="sm" type="button" variant="ghost">
					Cancel
				</Button>
				<Button
					disabled={isPending}
					size="sm"
					type="submit"
					variant="destructive"
				>
					{isPending ? "Banning..." : "Confirm Ban"}
				</Button>
			</div>
		</form>
	);
}

function UserMembershipsSection({
	memberships,
}: {
	memberships: AdminUserDetailResponse["memberships"];
}) {
	return (
		<div className="space-y-2">
			<h3 className="text-xs font-semibold tracking-wide uppercase">
				Workspace Memberships ({memberships.length})
			</h3>
			{memberships.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					Not a member of any organization.
				</p>
			) : (
				<div className="divide-border border-border divide-y rounded-lg border">
					{memberships.map((membership) => (
						<div
							className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
							key={membership.memberId}
						>
							<div>
								<p className="font-medium">{membership.organizationName}</p>
								<p className="text-muted-foreground font-mono text-[11px]">
									{membership.organizationSlug}
								</p>
							</div>
							<Badge className="capitalize" variant="outline">
								{membership.role}
							</Badge>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function UserSessionsSection({
	currentSessionId,
	isRevoking,
	isSelf,
	onRevokeAll,
	onRevokeOne,
	sessions,
}: {
	currentSessionId: string | null;
	isRevoking: boolean;
	isSelf: boolean;
	onRevokeAll: () => void;
	onRevokeOne: (sessionId: string) => void;
	sessions: AdminUserDetailResponse["sessions"];
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-xs font-semibold tracking-wide uppercase">
					Active Sessions ({sessions.length})
				</h3>
				{sessions.length > 0 && !isSelf ? (
					<Button
						disabled={isRevoking}
						onClick={onRevokeAll}
						size="sm"
						type="button"
						variant="outline"
					>
						<LogOut aria-hidden="true" className="mr-1.5 size-3.5" />
						Revoke All
					</Button>
				) : null}
			</div>
			{sessions.length === 0 ? (
				<p className="text-muted-foreground text-xs">No active sessions.</p>
			) : (
				<div className="divide-border border-border divide-y rounded-lg border">
					{sessions.map((item) => {
						const isCurrent = isSelf && currentSessionId === item.id;
						return (
							<div
								className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
								key={item.id}
							>
								<div className="min-w-0">
									<p className="truncate font-mono">
										{item.ipAddress ?? "Unknown IP"}
										{item.impersonatedBy ? (
											<span className="ml-2 text-amber-600 dark:text-amber-400">
												(impersonated)
											</span>
										) : null}
									</p>
									<p className="text-muted-foreground truncate text-[11px]">
										{item.userAgent ?? "Unknown client"} · expires{" "}
										{formatDateTime(item.expiresAt)}
									</p>
								</div>
								{isCurrent ? (
									<Badge variant="outline">Current</Badge>
								) : (
									<Button
										disabled={isRevoking}
										onClick={() => onRevokeOne(item.id)}
										size="sm"
										type="button"
										variant="ghost"
									>
										Revoke
									</Button>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function UserStatusSummary({
	isTargetAdmin,
	user,
}: {
	isTargetAdmin: boolean;
	user: AdminUserDetailResponse["user"];
}) {
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={isTargetAdmin ? "warning" : "secondary"}>
					{isTargetAdmin ? "Platform Admin" : "Standard User"}
				</Badge>
				<Badge variant={user.emailVerified ? "success" : "outline"}>
					{user.emailVerified ? "Email Verified" : "Unverified"}
				</Badge>
				<Badge variant={user.twoFactorEnabled ? "success" : "outline"}>
					{user.twoFactorEnabled ? "2FA Enabled" : "2FA Off"}
				</Badge>
				{user.banned ? <Badge variant="destructive">Banned</Badge> : null}
			</div>

			{user.banned ? (
				<div className="border-destructive/40 bg-destructive/5 rounded-lg border p-3 text-xs">
					<p className="text-destructive font-semibold">Account suspended</p>
					<p className="mt-1">
						Reason: {user.banReason || "No reason provided"}
					</p>
					{user.banExpires ? (
						<p className="text-muted-foreground mt-0.5">
							Expires: {formatDateTime(user.banExpires)}
						</p>
					) : null}
				</div>
			) : null}
		</>
	);
}

function UserDetailContent({
	data,
	isSelf,
	onClose,
}: {
	data: AdminUserDetailResponse;
	isSelf: boolean;
	onClose: () => void;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const currentSession = useSession();
	const updateRole = useUpdateAdminUserRole();
	const banUser = useBanAdminUser();
	const unbanUser = useUnbanAdminUser();
	const revokeSession = useRevokeAdminUserSession();
	const revokeAllSessions = useRevokeAllAdminUserSessions();
	const [showBanForm, setShowBanForm] = useState(false);
	const [isImpersonating, setIsImpersonating] = useState(false);

	const { memberships, sessions, user } = data;
	const isTargetAdmin = isPlatformAdminRole(user.role);

	const handleToggleRole = () => {
		const nextRole = isTargetAdmin ? "user" : "admin";
		void runAdminAction(
			() => updateRole.mutateAsync({ role: nextRole, userId: user.id }),
			{
				errorFallback: "Failed to update role",
				successMessage:
					nextRole === "admin"
						? `${user.email} promoted to platform admin`
						: `${user.email} demoted to standard user`,
			}
		);
	};

	const handleBan = async (params: {
		expiresInDays?: number;
		reason: string;
	}) => {
		const result = await runAdminAction(
			() => banUser.mutateAsync({ ...params, userId: user.id }),
			{
				errorFallback: "Failed to ban user",
				successMessage: `${user.email} has been banned and signed out.`,
			}
		);
		if (result !== undefined) {
			setShowBanForm(false);
		}
	};

	const handleImpersonate = async () => {
		setIsImpersonating(true);
		try {
			const result = await authClient.admin.impersonateUser({
				userId: user.id,
			});
			if (result.error) {
				toast.error(result.error.message || "Failed to start impersonation");
				return;
			}
			queryClient.clear();
			await currentSession.refetch();
			toast.success(`Now impersonating ${user.email}`);
			onClose();
			router.push(memberships.length > 0 ? "/dashboard" : "/settings/account");
			router.refresh();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to start impersonation"
			);
		} finally {
			setIsImpersonating(false);
		}
	};

	return (
		<div className="space-y-5 text-sm">
			<UserStatusSummary isTargetAdmin={isTargetAdmin} user={user} />

			<div className="border-border flex flex-wrap gap-2 border-y py-3">
				<Button
					disabled={isSelf || updateRole.isPending}
					onClick={handleToggleRole}
					size="sm"
					type="button"
					variant="outline"
				>
					{isTargetAdmin ? (
						<>
							<ShieldOff aria-hidden="true" className="mr-1.5 size-3.5" />
							Demote to User
						</>
					) : (
						<>
							<ShieldCheck aria-hidden="true" className="mr-1.5 size-3.5" />
							Promote to Admin
						</>
					)}
				</Button>
				{user.banned ? (
					<Button
						disabled={unbanUser.isPending}
						onClick={() =>
							void runAdminAction(() => unbanUser.mutateAsync(user.id), {
								errorFallback: "Failed to unban user",
								successMessage: `${user.email} has been unbanned.`,
							})
						}
						size="sm"
						type="button"
						variant="outline"
					>
						<UserCheck aria-hidden="true" className="mr-1.5 size-3.5" />
						{unbanUser.isPending ? "Unbanning..." : "Unban User"}
					</Button>
				) : (
					<Button
						disabled={isSelf || isTargetAdmin}
						onClick={() => setShowBanForm((prev) => !prev)}
						size="sm"
						type="button"
						variant="destructive"
					>
						<Ban aria-hidden="true" className="mr-1.5 size-3.5" />
						Ban User
					</Button>
				)}
				<Button
					disabled={isSelf || isTargetAdmin || user.banned || isImpersonating}
					onClick={() => void handleImpersonate()}
					size="sm"
					type="button"
					variant="secondary"
				>
					<UserCog aria-hidden="true" className="mr-1.5 size-3.5" />
					{isImpersonating ? "Starting..." : "Impersonate"}
				</Button>
				<Button asChild size="sm" variant="ghost">
					<Link
						href={`/admin/audit?userId=${encodeURIComponent(user.id)}`}
						onClick={onClose}
					>
						<ScrollText aria-hidden="true" className="mr-1.5 size-3.5" />
						Audit Trail
					</Link>
				</Button>
			</div>

			{showBanForm && !user.banned ? (
				<UserBanForm
					isPending={banUser.isPending}
					onCancel={() => setShowBanForm(false)}
					onSubmit={handleBan}
				/>
			) : null}

			<UserMembershipsSection memberships={memberships} />

			<UserSessionsSection
				currentSessionId={currentSession.data?.session.id ?? null}
				isRevoking={revokeSession.isPending || revokeAllSessions.isPending}
				isSelf={isSelf}
				onRevokeAll={() =>
					void runAdminAction(() => revokeAllSessions.mutateAsync(user.id), {
						errorFallback: "Failed to revoke sessions",
						successMessage: ({ revokedCount }) =>
							`Revoked ${revokedCount} active session(s).`,
					})
				}
				onRevokeOne={(sessionId) =>
					void runAdminAction(
						() => revokeSession.mutateAsync({ sessionId, userId: user.id }),
						{
							errorFallback: "Failed to revoke session",
							successMessage: "Session revoked.",
						}
					)
				}
				sessions={sessions}
			/>
		</div>
	);
}

export function UserDetailDialog({
	onClose,
	userId,
}: {
	onClose: () => void;
	userId: string | null;
}) {
	const currentSession = useSession();
	const detailQuery = useAdminUserDetail(userId);
	const user = detailQuery.data?.user;
	const isSelf = Boolean(user && currentSession.data?.user.id === user.id);
	const descriptionText = user ? `${user.email} · ${user.id}` : (userId ?? "");

	let body: React.ReactNode;
	if (detailQuery.isError) {
		body = (
			<p className="text-destructive text-sm" role="alert">
				{detailQuery.error instanceof Error
					? detailQuery.error.message
					: "Failed to load user details."}
			</p>
		);
	} else if (detailQuery.isPending || !detailQuery.data) {
		body = (
			<div className="space-y-3">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	} else {
		body = (
			<UserDetailContent
				data={detailQuery.data}
				isSelf={isSelf}
				key={detailQuery.data.user.id}
				onClose={onClose}
			/>
		);
	}

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={userId !== null}
		>
			<DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{user?.name || "User Details"}</DialogTitle>
					<DialogDescription className="font-mono text-xs">
						{descriptionText}
					</DialogDescription>
				</DialogHeader>
				{body}
			</DialogContent>
		</Dialog>
	);
}
