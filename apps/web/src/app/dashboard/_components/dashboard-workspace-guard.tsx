"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { useOrganizationMutations } from "@/lib/organization-hooks";

interface DashboardWorkspaceGuardProps {
	children: ReactNode;
	preferredOrganizationId: string | null;
}

/**
 * Enforces the dashboard onboarding gate when organization count drops to zero
 * (e.g. deleting or leaving the last workspace) and auto-activates a remembered
 * default organization if a session enters without an active organization.
 */
export function DashboardWorkspaceGuard({
	children,
	preferredOrganizationId,
}: DashboardWorkspaceGuardProps) {
	const router = useRouter();
	const listOrgs = authClient.useListOrganizations();
	const activeOrg = authClient.useActiveOrganization();
	const session = authClient.useSession();
	const { setActiveOrganization } = useOrganizationMutations({
		showToasts: false,
	});

	const redirectedToOnboardingRef = useRef<boolean>(false);
	const attemptedActivationRef = useRef(false);

	const organizations = listOrgs.data;
	const hasSettledList =
		!(listOrgs.isPending || listOrgs.isRefetching || listOrgs.error) &&
		Array.isArray(organizations);

	const hasNoOrganizations = hasSettledList && organizations.length === 0;
	const resolvedActiveOrgId =
		activeOrg.data?.id ?? session.data?.session?.activeOrganizationId ?? null;

	useEffect(() => {
		if (!hasSettledList) {
			return;
		}

		if (organizations.length === 0) {
			if (!redirectedToOnboardingRef.current) {
				redirectedToOnboardingRef.current = true;
				router.replace("/onboarding");
			}
			return;
		}

		redirectedToOnboardingRef.current = false;

		if (resolvedActiveOrgId) {
			attemptedActivationRef.current = false;
			return;
		}

		if (
			activeOrg.isPending ||
			activeOrg.isRefetching ||
			session.isPending ||
			attemptedActivationRef.current
		) {
			return;
		}

		const targetOrgId =
			preferredOrganizationId &&
			organizations.some((org) => org.id === preferredOrganizationId)
				? preferredOrganizationId
				: organizations[0]?.id;

		if (!targetOrgId) {
			return;
		}

		attemptedActivationRef.current = true;
		void setActiveOrganization({ organizationId: targetOrgId })
			.then(() => {
				router.refresh();
			})
			.catch(() => {
				// Avoid tight retry loops when activation fails transiently.
			});
	}, [
		activeOrg.isPending,
		activeOrg.isRefetching,
		hasSettledList,
		organizations,
		preferredOrganizationId,
		resolvedActiveOrgId,
		router,
		session.isPending,
		setActiveOrganization,
	]);

	if (hasNoOrganizations) {
		return (
			<div
				aria-live="polite"
				className="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center p-6"
				role="status"
			>
				<div className="text-muted-foreground flex items-center gap-2.5 text-sm font-medium">
					<Loader2 className="text-primary h-5 w-5 animate-spin" />
					<span>Redirecting to workspace setup...</span>
				</div>
			</div>
		);
	}

	return <>{children}</>;
}
