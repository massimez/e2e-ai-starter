"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { DeleteConfirmationDialog } from "@workspace/ui/components/delete-confirmation-dialog";
import {
	SettingsSection,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth-client";
import { parseSessionDevice } from "@/lib/session-device";
import { useAuthModal } from "@/providers/auth-provider";

const deviceIcons = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };
const signedInDate = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

export function ActiveSessions() {
	const {
		data: current,
		isPending,
		error: sessionError,
		refetch: refreshSession,
	} = useSession();
	const { openSignIn } = useAuthModal();
	const currentId = current?.session.id;
	const query = useQuery({
		queryKey: ["active-sessions", currentId],
		enabled: Boolean(currentId),
		gcTime: 0,
		staleTime: 0,
		refetchOnWindowFocus: true,
		retry: false,
		queryFn: async ({ signal }) => {
			const { data, error } = await authClient.listSessions({
				fetchOptions: { cache: "no-store", signal },
			});
			if (error?.code === "SESSION_NOT_FRESH" || error?.status === 401) {
				return null;
			}
			if (error) {
				throw new Error(error.message || "Could not load sessions.");
			}
			return data.toSorted(
				(a, b) =>
					Number(b.id === currentId) - Number(a.id === currentId) ||
					new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
			);
		},
	});

	async function revoke(token?: string) {
		try {
			const result =
				token === undefined
					? await authClient.revokeOtherSessions()
					: await authClient.revokeSession({ token });
			if (result.error) {
				throw new Error(
					result.error.message || "Could not sign out. Try again."
				);
			}
			toast.success(
				token === undefined ? "Other sessions signed out" : "Session signed out"
			);
			await query.refetch();
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not sign out. Try again."
			);
			throw error;
		}
	}

	const sessions = query.data ?? [];
	const requiresSignIn =
		!(isPending || current || sessionError) || query.data === null;
	const hasOthers = sessions.some((session) => session.id !== currentId);
	let content: ReactNode;
	if (requiresSignIn) {
		content = (
			<div className="space-y-2 p-5">
				<p className="text-sm">Sign in again to manage your sessions.</p>
				<Button
					onClick={() =>
						openSignIn({
							socialRedirectTo: "/settings/account/security",
							onSuccess: async () => {
								await refreshSession();
							},
						})
					}
					size="sm"
					variant="outline"
				>
					Sign in again
				</Button>
			</div>
		);
	} else if (query.isError || sessionError) {
		content = (
			<div className="space-y-2 p-5">
				<p className="text-sm" role="alert">
					Could not load your sessions.
				</p>
				<Button
					onClick={() =>
						sessionError ? void refreshSession() : void query.refetch()
					}
					size="sm"
					variant="outline"
				>
					Try again
				</Button>
			</div>
		);
	} else if (isPending || query.isPending) {
		content = (
			<p className="text-muted-foreground p-5 text-sm" role="status">
				Loading sessions…
			</p>
		);
	} else if (sessions.length) {
		content = (
			<ul className="divide-border divide-y">
				{sessions.map((session) => {
					const device = parseSessionDevice(session.userAgent);
					const Icon = deviceIcons[device.type];
					const isCurrent = session.id === currentId;
					const started = new Date(session.createdAt);
					return (
						<li
							className="flex items-center gap-3 px-4 py-3 sm:px-6"
							key={session.id}
						>
							<Icon
								aria-hidden="true"
								className="text-muted-foreground size-5 shrink-0"
							/>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
									<span className="text-sm font-medium">{device.label}</span>
									{isCurrent && (
										<Badge variant="secondary">Current session</Badge>
									)}
								</div>
								<p className="text-muted-foreground mt-0.5 text-xs leading-relaxed wrap-anywhere">
									Signed in{" "}
									<time dateTime={started.toISOString()}>
										{signedInDate.format(started)}
									</time>
									{session.ipAddress ? ` · IP ${session.ipAddress}` : null}
								</p>
							</div>
							{!isCurrent && (
								<DeleteConfirmationDialog
									confirmLabel="Sign out"
									description={`The ${device.label} session will end. You’ll need to sign in again on that device.`}
									onConfirm={() => revoke(session.token)}
									title="Sign out this session?"
								>
									<Button
										aria-label={`Sign out ${device.label}, signed in ${signedInDate.format(started)}`}
										size="sm"
										variant="ghost"
									>
										Sign out
									</Button>
								</DeleteConfirmationDialog>
							)}
						</li>
					);
				})}
			</ul>
		);
	} else {
		content = (
			<p className="text-muted-foreground p-5 text-sm">
				No active sessions found.
			</p>
		);
	}

	return (
		<SettingsSection>
			<SettingsSectionHeader
				action={
					currentId && query.isSuccess && hasOthers ? (
						<DeleteConfirmationDialog
							confirmLabel="Sign out other sessions"
							description="You’ll stay signed in here. Your other devices will need to sign in again."
							onConfirm={() => revoke()}
							title="Sign out all other sessions?"
						>
							<Button size="sm" variant="outline">
								Sign out other sessions
							</Button>
						</DeleteConfirmationDialog>
					) : undefined
				}
				description="Devices signed in to your account."
				title="Active Sessions"
			/>
			{content}
		</SettingsSection>
	);
}
