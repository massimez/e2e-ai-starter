"use client";

import { NotificationCenter } from "@workspace/ui/components/notification-center";
import {
	type OrganizationItem,
	OrganizationSwitcher,
} from "@workspace/ui/components/organization-switcher";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserAccountMenu } from "@/components/user-account-menu";
import { publicWebEnv } from "@/env";
import {
	useCurrentOrganization,
	useOrganizationMutations,
} from "@/lib/organization-hooks";

export function DashboardHeader() {
	const router = useRouter();
	const { activeOrgId, currentUserRole, organizations, session } =
		useCurrentOrganization();
	const { createOrganization, setActiveOrganization } =
		useOrganizationMutations({
			showToasts: false,
		});

	const orgItems: OrganizationItem[] = organizations.map((org) => ({
		id: org.id,
		logo: org.logo,
		name: org.name,
		slug: org.slug,
	}));

	const handleSelectOrg = async (orgId: string) => {
		await setActiveOrganization({ organizationId: orgId });
		router.refresh();
	};

	const handleCreateOrg = async (name: string, slug: string) => {
		await createOrganization({ name, slug });
		router.refresh();
	};

	return (
		<AppHeader
			actions={
				<>
					<ThemeToggle />
					<NotificationCenter
						apiUrl={publicWebEnv.apiUrl}
						onNavigate={(path) => router.push(path)}
					/>
					<OrganizationSwitcher
						activeOrgId={activeOrgId}
						onCreateOrg={handleCreateOrg}
						onSelectOrg={handleSelectOrg}
						organizations={orgItems}
					/>
					<UserAccountMenu
						redirectAfterSignOut="/"
						role={currentUserRole}
						user={session?.user}
					/>
				</>
			}
			brandHref="/dashboard"
		/>
	);
}
