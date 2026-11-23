"use client";

import { cn } from "@workspace/ui/lib/utils";
import {
	AlertTriangle,
	Bell,
	Building,
	LayoutGrid,
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

export function SettingsNav({ scope }: { scope: "workspace" | "account" }) {
	const navItems = scope === "account" ? accountNav : workspaceNav;
	const pathname = usePathname();

	return (
		<div className="border-border/50 flex border-b pb-1">
			<nav
				aria-label={
					scope === "account" ? "Account settings" : "Workspace settings"
				}
				className="-mb-px flex space-x-1.5 overflow-x-auto sm:space-x-2"
			>
				{navItems.map((item) => {
					const Icon = item.icon;
					const isActive = pathname === item.href;

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
