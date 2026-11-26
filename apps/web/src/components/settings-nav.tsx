"use client";

import { cn } from "@workspace/ui/lib/utils";
import {
	Activity,
	AlertTriangle,
	Bell,
	Building,
	Building2,
	LayoutGrid,
	ScrollText,
	ShieldCheck,
	UserRound,
	Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const workspaceNav = [
	{
		href: "/settings/workspace",
		icon: LayoutGrid,
		label: "Overview",
	},
	{
		href: "/settings/workspace/general",
		icon: Building,
		label: "General Profile",
	},
	{
		href: "/settings/workspace/members",
		icon: Users,
		label: "Members & Team",
	},
	{
		href: "/settings/workspace/roles",
		icon: ShieldCheck,
		label: "Roles Matrix",
	},
	{
		href: "/settings/workspace/notifications",
		icon: Bell,
		label: "Notifications",
	},
	{
		href: "/settings/workspace/advanced",
		icon: AlertTriangle,
		label: "Danger Zone",
	},
];

const accountNav = [
	{ href: "/settings/account", icon: LayoutGrid, label: "Overview" },
	{ href: "/settings/account/profile", icon: UserRound, label: "Profile" },
	{ href: "/settings/account/security", icon: ShieldCheck, label: "Security" },
];

const adminNav = [
	{ href: "/admin", icon: LayoutGrid, label: "Overview" },
	{ href: "/admin/users", icon: Users, label: "Users" },
	{ href: "/admin/organizations", icon: Building2, label: "Organizations" },
	{ href: "/admin/audit", icon: ScrollText, label: "Audit Logs" },
	{ href: "/admin/system", icon: Activity, label: "System" },
];

const ROOT_SCOPE_HREFS = new Set([
	"/admin",
	"/settings/account",
	"/settings/workspace",
]);

const NAV_CONFIG = {
	account: { items: accountNav, label: "Account settings" },
	admin: { items: adminNav, label: "Platform backoffice navigation" },
	workspace: { items: workspaceNav, label: "Workspace settings" },
} as const;

export function SettingsNav({
	scope,
}: {
	scope: "workspace" | "account" | "admin";
}) {
	const { items: navItems, label } = NAV_CONFIG[scope];
	const pathname = usePathname();

	return (
		<div className="border-border/50 flex border-b pb-1">
			<nav
				aria-label={label}
				className="-mb-px flex space-x-1.5 overflow-x-auto sm:space-x-2"
			>
				{navItems.map((item) => {
					const Icon = item.icon;
					const isActive = ROOT_SCOPE_HREFS.has(item.href)
						? pathname === item.href
						: pathname === item.href || pathname.startsWith(`${item.href}/`);

					return (
						<Link
							aria-current={isActive ? "page" : undefined}
							className={cn(
								"flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-medium whitespace-nowrap transition-all duration-200 sm:text-sm",
								isActive
									? "border-primary text-foreground font-semibold"
									: "text-muted-foreground hover:border-border/80 hover:text-foreground border-transparent"
							)}
							href={item.href}
							key={item.href}
						>
							<Icon
								aria-hidden="true"
								className={cn(
									"h-4 w-4 transition-colors",
									isActive ? "text-primary" : "text-muted-foreground"
								)}
							/>
							{item.label}
						</Link>
					);
				})}
			</nav>
		</div>
	);
}
