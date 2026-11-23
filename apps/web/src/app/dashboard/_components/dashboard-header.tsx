"use client";

import { useQuery } from "@tanstack/react-query";
import { NotificationCenter } from "@workspace/ui/components/notification-center";
import {
	type OrganizationItem,
	OrganizationSwitcher,
} from "@workspace/ui/components/organization-switcher";
import { usePathname, useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ThemeToggle } from "@/components/theme-toggle";
import {
	type AccountMenuUser,
	UserAccountMenu,
} from "@/components/user-account-menu";
import { authClient } from "@/lib/auth-client";
import type { ServerOrganization } from "@/lib/auth-server";
import { useOrganizationMutations } from "@/lib/organization-hooks";

const _DASHBOARD_NAV_ITEMS = [
	{ href: "/dashboard", label: "Overview", exact: true },
	{ href: "/dashboard/files", label: "Files & RAG", exact: false },
	{ href: "/dashboard/ai", label: "AI Assistant", exact: false },
	{ href: "/settings/workspace", label: "Settings", exact: false },
] as const;

interface DashboardHeaderProps {
	initialActiveOrgId?: string | null;
	initialOrganizations?: ServerOrganization[];
	initialUser?: AccountMenuUser | null;
}

export function DashboardHeader({
	initialActiveOrgId = null,
	initialOrganizations = [],
	initialUser = null,
}: DashboardHeaderProps) {
	const router = useRouter();
	const _pathname = usePathname();
	const session = authClient.useSession();
	const activeOrg = authClient.useActiveOrganization();
	const listOrgs = authClient.useListOrganizations();
	const { createOrganization, setActiveOrganization } =
		useOrganizationMutations({
			showToasts: false,
		});

	const resolvedUser = session.data?.user ?? initialUser;
	const resolvedOrganizations = listOrgs.isPending
		? initialOrganizations
		: (listOrgs.data ?? []);
	const resolvedActiveOrgId = activeOrg.data?.id ?? initialActiveOrgId;

	const activeRoleQuery = useQuery<string | null>({
		enabled: Boolean(resolvedActiveOrgId && resolvedUser),
		queryFn: async () => {
			const res = await authClient.organization.getActiveMemberRole();
			if (res.error) {
				return null;
			}
			return (res.data as { role?: string } | null)?.role ?? null;
		},
		queryKey: [
			"organizations",
			"active-member-role",
			resolvedActiveOrgId ?? "none",
		],
		staleTime: 30_000,
	});
	const currentUserRole = activeRoleQuery.data ?? null;

	const orgItems: OrganizationItem[] = resolvedOrganizations.map((org) => ({
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
						apiUrl=""
						enabled={Boolean(resolvedUser)}
						onNavigate={(path) => router.push(path)}
					/>
					<OrganizationSwitcher
						activeOrgId={resolvedActiveOrgId}
						onCreateOrg={handleCreateOrg}
						onSelectOrg={handleSelectOrg}
						organizations={orgItems}
					/>
					<UserAccountMenu
						redirectAfterSignOut="/"
						role={currentUserRole}
						user={resolvedUser}
					/>
				</>
			}
			brandHref="/dashboard"
		/>
	);
}
