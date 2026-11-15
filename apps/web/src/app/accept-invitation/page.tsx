"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@workspace/ui/components/card";
import {
	AlertTriangle,
	Building2,
	CheckCircle2,
	Loader2,
	LogIn,
	MailCheck,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient, useSession } from "@/lib/auth-client";
import { syncOrganizationClientState } from "@/lib/organization-hooks";
import { useAuthModal } from "@/providers/auth-provider";

interface InvitationSummary {
	email: string;
	expiresAt?: string | Date;
	id: string;
	inviterEmail?: string;
	organizationName?: string;
	organizationSlug?: string;
	role: string;
	status: string;
}

async function fetchInvitationDetails(
	invitationId: string
): Promise<{ data?: InvitationSummary; error?: string }> {
	try {
		const res = await authClient.organization.getInvitation({
			query: { id: invitationId },
		});
		if (res.error) {
			return {
				error:
					res.error.message || "Invitation could not be found or has expired.",
			};
		}
		return {
			data: res.data ? (res.data as unknown as InvitationSummary) : undefined,
		};
	} catch (error) {
		return {
			error:
				error instanceof Error
					? error.message
					: "Failed to load invitation details",
		};
	}
}

function AcceptInvitationContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const { data: session, isPending: isSessionPending } = useSession();
	const { openSignIn, openSignUp } = useAuthModal();

	const invitationId =
		searchParams.get("invitationId") || searchParams.get("id") || "";

	const [invitation, setInvitation] = useState<InvitationSummary | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [isLoadingInvite, setIsLoadingInvite] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);

	useEffect(() => {
		if (!(invitationId && session?.user)) {
			return;
		}

		let cancelled = false;
		async function loadInvitation() {
			setIsLoadingInvite(true);
			setLoadError(null);
			const result = await fetchInvitationDetails(invitationId);
			if (cancelled) {
				return;
			}
			if (result.error) {
				setLoadError(result.error);
			} else if (result.data) {
				setInvitation(result.data);
			}
			setIsLoadingInvite(false);
		}

		void loadInvitation();
		return () => {
			cancelled = true;
		};
	}, [invitationId, session?.user]);

	const handleAccept = async () => {
		if (!invitationId) {
			return;
		}
		setIsProcessing(true);
		try {
			const res = await authClient.organization.acceptInvitation({
				invitationId,
			});
			if (res.error) {
				toast.error(res.error.message || "Failed to accept invitation");
				return;
			}

			const acceptedOrgId = (
				res.data as { invitation?: { organizationId?: string } } | null
			)?.invitation?.organizationId;
			if (acceptedOrgId) {
				await authClient.organization.setActive({
					organizationId: acceptedOrgId,
				});
			}

			await syncOrganizationClientState(queryClient, acceptedOrgId);
			toast.success("Invitation accepted! Welcome to the workspace.");
			router.push("/dashboard");
			router.refresh();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to accept invitation"
			);
		} finally {
			setIsProcessing(false);
		}
	};

	const handleDecline = async () => {
		if (!invitationId) {
			return;
		}
		setIsProcessing(true);
		try {
			const res = await authClient.organization.rejectInvitation({
				invitationId,
			});
			if (res.error) {
				toast.error(res.error.message || "Failed to decline invitation");
				return;
			}
			toast.info("Invitation declined.");
			router.push("/");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to decline invitation"
			);
		} finally {
			setIsProcessing(false);
		}
	};

	if (!invitationId) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<XCircle className="text-destructive h-5 w-5" />
						Missing Invitation Link
					</CardTitle>
					<CardDescription>
						No invitation ID was found in this URL. Please open the full link
						from your invitation email.
					</CardDescription>
				</CardHeader>
				<CardFooter>
					<Button asChild className="w-full" variant="outline">
						<Link href="/">Return Home</Link>
					</Button>
				</CardFooter>
			</Card>
		);
	}

	if (isSessionPending || isLoadingInvite) {
		return (
			<Card className="w-full max-w-md">
				<CardContent className="flex flex-col items-center justify-center gap-3 py-12">
					<Loader2 className="text-primary h-7 w-7 animate-spin" />
					<p className="text-muted-foreground text-sm">
						Verifying workspace invitation...
					</p>
				</CardContent>
			</Card>
		);
	}

	if (!session?.user) {
		const callbackUrl = `/accept-invitation?invitationId=${encodeURIComponent(invitationId)}`;
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<div className="bg-primary/10 text-primary mb-2 flex h-11 w-11 items-center justify-center rounded-xl">
						<MailCheck className="h-6 w-6" />
					</div>
					<CardTitle className="text-xl">Sign In to Join Workspace</CardTitle>
					<CardDescription>
						You&apos;ve been invited to collaborate in an organization
						workspace. Sign in or create an account using your invited email
						address to accept.
					</CardDescription>
				</CardHeader>
				<CardFooter className="flex flex-col gap-2.5 sm:flex-row">
					<Button
						className="w-full gap-2 sm:flex-1"
						onClick={() =>
							openSignIn({
								onSuccess: () => router.refresh(),
								socialRedirectTo: callbackUrl,
							})
						}
						type="button"
						variant="primary"
					>
						<LogIn className="h-4 w-4" />
						Sign In
					</Button>
					<Button
						className="w-full sm:flex-1"
						onClick={() =>
							openSignUp({
								onSuccess: () => router.refresh(),
								socialRedirectTo: callbackUrl,
							})
						}
						type="button"
						variant="outline"
					>
						Create Account
					</Button>
				</CardFooter>
			</Card>
		);
	}

	if (loadError) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<XCircle className="text-destructive h-5 w-5" />
						Invitation Unavailable
					</CardTitle>
					<CardDescription>{loadError}</CardDescription>
				</CardHeader>
				<CardFooter className="flex gap-2">
					<Button asChild className="flex-1" variant="outline">
						<Link href="/dashboard">Go to Dashboard</Link>
					</Button>
				</CardFooter>
			</Card>
		);
	}

	const hasEmailMismatch =
		Boolean(invitation?.email) &&
		session.user.email.toLowerCase() !== invitation?.email.toLowerCase();

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<div className="bg-primary/10 text-primary mb-2 flex h-11 w-11 items-center justify-center rounded-xl">
					<Building2 aria-hidden="true" className="h-6 w-6" />
				</div>
				<CardTitle className="text-xl">Workspace Invitation</CardTitle>
				<CardDescription>
					{invitation?.organizationName
						? `You have been invited to join ${invitation.organizationName}.`
						: "Review and respond to this organization invitation."}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				<div className="bg-muted/40 space-y-2 rounded-xl border p-4">
					{invitation?.organizationName ? (
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Organization</span>
							<span className="font-semibold">
								{invitation.organizationName}
							</span>
						</div>
					) : null}
					{invitation?.email ? (
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Invited email</span>
							<span className="truncate font-medium">{invitation.email}</span>
						</div>
					) : null}
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground">Signed in as</span>
						<span className="truncate font-medium">{session.user.email}</span>
					</div>
					{invitation?.role ? (
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Assigned role</span>
							<Badge className="capitalize" variant="outline">
								{invitation.role}
							</Badge>
						</div>
					) : null}
				</div>

				{hasEmailMismatch ? (
					<div
						className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
						role="alert"
					>
						<AlertTriangle
							aria-hidden="true"
							className="mt-0.5 h-4 w-4 shrink-0"
						/>
						<p className="leading-relaxed">
							This invitation was sent to{" "}
							<strong className="font-semibold">{invitation?.email}</strong>,
							but you are currently signed in as{" "}
							<strong className="font-semibold">{session.user.email}</strong>.
							Accepting may fail unless you sign in with the invited email.
						</p>
					</div>
				) : null}
			</CardContent>
			<CardFooter className="flex flex-col gap-2.5 sm:flex-row">
				<Button
					className="w-full gap-2 sm:flex-1"
					disabled={isProcessing}
					onClick={() => void handleAccept()}
					type="button"
					variant="primary"
				>
					{isProcessing ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<CheckCircle2 className="h-4 w-4" />
					)}
					Accept Invitation
				</Button>
				<Button
					className="w-full sm:w-auto"
					disabled={isProcessing}
					onClick={() => void handleDecline()}
					type="button"
					variant="ghost"
				>
					Decline
				</Button>
			</CardFooter>
		</Card>
	);
}

export default function AcceptInvitationPage() {
	return (
		<div className="bg-muted/20 flex min-h-screen flex-col">
			<AppHeader actions={<ThemeToggle />} brandHref="/" />
			<main
				className="flex flex-1 items-center justify-center p-6 outline-none"
				id="main-content"
				tabIndex={-1}
			>
				<Suspense
					fallback={
						<div className="flex items-center gap-2 text-sm">
							<Loader2 className="h-5 w-5 animate-spin" />
							Loading invitation...
						</div>
					}
				>
					<AcceptInvitationContent />
				</Suspense>
			</main>
		</div>
	);
}
