"use client";

import { cn } from "@workspace/ui/lib/utils";
import {
	AlertTriangle,
	Bell,
	Building,
	LayoutGrid,
	ShieldCheck,
	Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
	{
		href: "/dashboard/settings",
		icon: LayoutGrid,
		label: "Overview",
	},
	{
		href: "/dashboard/settings/general",
		icon: Building,
		label: "General Profile",
	},
	{
		href: "/dashboard/settings/members",
		icon: Users,
		label: "Members & Team",
	},
	{
		href: "/dashboard/settings/roles",
		icon: ShieldCheck,
		label: "Roles Matrix",
	},
	{
		href: "/dashboard/settings/notifications",
		icon: Bell,
		label: "Notifications",
	},
	{
		href: "/dashboard/settings/advanced",
		icon: AlertTriangle,
		label: "Danger Zone",
	},
];

export function SettingsNav() {
	const pathname = usePathname();

	return (
		<div className="border-border/50 flex border-b pb-1">
			<nav
				aria-label="Settings navigation"
				className="-mb-px flex space-x-1.5 overflow-x-auto sm:space-x-2"
			>
				{navItems.map((item) => {
					const Icon = item.icon;
					const isActive = pathname === item.href;

					return (
						<Link
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
