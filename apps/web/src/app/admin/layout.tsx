import { isPlatformAdminRole } from "@workspace/shared/permissions";
import { Badge } from "@workspace/ui/components/badge";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { SettingsNav } from "@/components/settings-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserAccountMenu } from "@/components/user-account-menu";
import { getServerSession, type ServerSession } from "@/lib/auth-server";

export const metadata: Metadata = {
	robots: {
		follow: false,
		index: false,
	},
	title: "Platform Backoffice",
};

function hasActiveBan(user: ServerSession["user"]): boolean {
	if (!user.banned) {
		return false;
	}
	if (!user.banExpires) {
		return true;
	}
	const expiresAt = new Date(user.banExpires).getTime();
	return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

/**
 * Server-enforced Platform Backoffice layout (`/admin/*`).
 * Strictly verifies `session.user.role === "admin"` (Better Auth `admin()` plugin),
 * rejects impersonated or actively banned sessions, and never checks tenant `member.role`.
 */
export default async function AdminBackofficeLayout({
	children,
}: {
	children: ReactNode;
}) {
	const session = await getServerSession();
	if (!session?.user) {
		redirect("/?auth=signin&callbackUrl=/admin");
	}
	if (
		session.session.impersonatedBy ||
		hasActiveBan(session.user) ||
		!isPlatformAdminRole(session.user.role)
	) {
		redirect("/dashboard");
	}

	return (
		<div className="bg-background flex min-h-screen flex-col">
			<AppHeader
				actions={
					<div className="flex items-center gap-2">
						<Badge className="gap-1 font-mono text-[11px]" variant="warning">
							<ShieldAlert aria-hidden="true" className="size-3" />
							Platform Backoffice
						</Badge>
						<Link
							className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
							href="/dashboard"
						>
							<ArrowLeft aria-hidden="true" className="size-3.5" />
							Workspace
						</Link>
						<ThemeToggle />
						<UserAccountMenu
							redirectAfterSignOut="/"
							role="Platform Admin"
							user={session.user}
						/>
					</div>
				}
				brandHref="/admin"
			/>

			<div className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
				<SettingsNav scope="admin" />

				<main>{children}</main>
			</div>
		</div>
	);
}
