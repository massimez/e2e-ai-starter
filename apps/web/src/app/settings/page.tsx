import { SettingsPage } from "@workspace/ui/components/settings-shell";
import { Building, UserRound } from "lucide-react";
import { DashboardTile } from "../dashboard/_components/dashboard-tile";

export default function SettingsIndexPage() {
	return (
		<div className="mx-auto max-w-7xl space-y-7 p-6 sm:p-10">
			<SettingsPage
				description="Choose which settings you want to manage."
				title="Settings"
			>
				<div className="grid gap-5 md:grid-cols-2">
					<DashboardTile
						description="Manage your profile, sign-in details, and security."
						href="/settings/account"
						icon={UserRound}
						title="Account"
					/>
					<DashboardTile
						description="Manage workspace profile, members, access, and notifications."
						href="/settings/workspace"
						icon={Building}
						title="Workspace"
					/>
				</div>
			</SettingsPage>
		</div>
	);
}
