import {
	AlertTriangle,
	ArrowRight,
	Bell,
	Building2,
	ShieldCheck,
	Sparkles,
	Users,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { DashboardTile } from "./_components/dashboard-tile";

export default async function DashboardPage() {
	const session = await getServerSession();
	if (!session?.user) {
		redirect("/?auth=signin&callbackUrl=/dashboard");
	}

	return (
		<div className="mx-auto max-w-6xl space-y-8 p-6 sm:p-10">
			<div className="space-y-1.5">
				<h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
					Welcome back, {session.user.name}
				</h1>
				<p className="text-muted-foreground text-sm">
					Manage your active workspace, team roles, and notification channels.
				</p>
			</div>

			<section className="space-y-4">
				<div className="flex items-center justify-between">
					<h2 className="text-foreground text-lg font-semibold tracking-tight">
						Workspace Settings & Management Hub
					</h2>
					<Link
						className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
						href="/dashboard/settings"
					>
						View all settings <ArrowRight className="h-3 w-3" />
					</Link>
				</div>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<DashboardTile
						description="Chat with Mastra agents (Gemini, OpenAI, Anthropic, OpenRouter) with workspace tools and pgvector memory."
						href="/dashboard/ai"
						icon={Sparkles}
						title="AI Assistant"
					/>
					<DashboardTile
						description="Configure workspace name, vanity URL slug, and cloud logo branding."
						href="/dashboard/settings/general"
						icon={Building2}
						title="General Profile"
					/>
					<DashboardTile
						description="Manage active teammates, pending invitations, and grant role permissions."
						href="/dashboard/settings/members"
						icon={Users}
						title="Team & Access"
					/>
					<DashboardTile
						description="Review granular capability boundaries for Owner, Admin, Member, and Viewer."
						href="/dashboard/settings/roles"
						icon={ShieldCheck}
						title="Roles & Matrix"
					/>
					<DashboardTile
						description="Customize in-app, email, and browser Web Push delivery preferences."
						href="/dashboard/settings/notifications"
						icon={Bell}
						title="Notification Preferences"
					/>
					<DashboardTile
						description="Ownership transfer workflows and permanent workspace destruction."
						href="/dashboard/settings/advanced"
						icon={AlertTriangle}
						title="Danger Zone"
					/>
				</div>
			</section>
		</div>
	);
}
