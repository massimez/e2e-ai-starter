import {
	AlertTriangle,
	Bell,
	Building2,
	ShieldCheck,
	Users,
} from "lucide-react";
import { DashboardTile } from "../_components/dashboard-tile";

const settingsCategories = [
	{
		badge: "Core",
		description:
			"Configure workspace brand identity, workspace slug, and cloud logo imagery.",
		href: "/settings/workspace/general",
		icon: Building2,
		title: "General Profile & Branding",
	},
	{
		badge: "Team",
		description:
			"Invite teammates, audit member roster, and adjust granular role allocations.",
		href: "/settings/workspace/members",
		icon: Users,
		title: "Members & Access Control",
	},
	{
		badge: "Security",
		description:
			"Review granular permissions matrix for Owner, Admin, Member, and Viewer roles.",
		href: "/settings/workspace/roles",
		icon: ShieldCheck,
		title: "Roles & RBAC Matrix",
	},
	{
		badge: "Alerts",
		description:
			"Configure in-app, email, and browser Web Push preferences by category.",
		href: "/settings/workspace/notifications",
		icon: Bell,
		title: "Notification Channels",
	},
	{
		badge: "Critical",
		description:
			"Transfer primary workspace ownership or execute permanent organization deletion.",
		href: "/settings/workspace/advanced",
		icon: AlertTriangle,
		title: "Danger Zone & Governance",
	},
];

export default function SettingsIndexPage() {
	return (
		<div className="space-y-6">
			<header>
				<h1 className="text-foreground text-xl font-semibold tracking-tight sm:text-2xl">
					Workspace Settings
				</h1>
				<p className="text-muted-foreground mt-1 text-sm leading-relaxed">
					Manage your organization profile, team access, roles, notification
					channels, and governance controls.
				</p>
			</header>

			{/* Category Cards Grid */}
			<div className="grid grid-cols-1 gap-5 md:grid-cols-2">
				{settingsCategories.map((cat) => (
					<DashboardTile
						badge={cat.badge}
						description={cat.description}
						href={cat.href}
						icon={cat.icon}
						key={cat.title}
						title={cat.title}
					/>
				))}
			</div>
		</div>
	);
}
