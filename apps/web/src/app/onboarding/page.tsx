import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerOrganizations, getServerSession } from "@/lib/auth-server";
import { resolveSafeOnboardingRedirect } from "./_components/onboarding-redirect";
import { OnboardingWorkspaceForm } from "./_components/onboarding-workspace-form";

export const metadata: Metadata = {
	robots: {
		follow: false,
		index: false,
	},
	title: "Create workspace",
};

export default async function OnboardingPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string | string[] }>;
}) {
	const [session, organizations, resolvedSearchParams] = await Promise.all([
		getServerSession(),
		getServerOrganizations(),
		searchParams,
	]);

	if (!session?.user) {
		redirect("/?auth=signin&callbackUrl=/onboarding");
	}

	const nextPath = resolveSafeOnboardingRedirect(resolvedSearchParams.next);

	if (organizations && organizations.length > 0) {
		redirect(nextPath);
	}

	return (
		<OnboardingWorkspaceForm
			nextPath={nextPath}
			userEmail={session.user.email}
			userName={session.user.name}
		/>
	);
}
