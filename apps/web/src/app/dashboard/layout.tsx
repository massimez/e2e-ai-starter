import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
	getServerDefaultOrganizationId,
	getServerOrganizations,
	getServerSession,
} from "@/lib/auth-server";
import { DashboardHeader } from "./_components/dashboard-header";
import { DashboardWorkspaceGuard } from "./_components/dashboard-workspace-guard";

export const metadata: Metadata = {
	robots: {
		follow: false,
		index: false,
	},
};

export default async function DashboardLayout({
	children,
}: {
	children: ReactNode;
}) {
	const [session, organizations] = await Promise.all([
		getServerSession(),
		getServerOrganizations(),
	]);

	if (!session?.user) {
		redirect("/?auth=signin&callbackUrl=/dashboard");
	}

	if (organizations !== null && organizations.length === 0) {
		redirect("/onboarding");
	}

	const activeOrganizationId = session.session.activeOrganizationId ?? null;
	const preferredOrganizationId =
		!activeOrganizationId && organizations && organizations.length > 0
			? await getServerDefaultOrganizationId()
			: null;

	return (
		<div className="bg-muted/20 text-foreground min-h-screen">
			<DashboardHeader />
			<DashboardWorkspaceGuard
				preferredOrganizationId={preferredOrganizationId}
			>
				<main>{children}</main>
			</DashboardWorkspaceGuard>
		</div>
	);
}
