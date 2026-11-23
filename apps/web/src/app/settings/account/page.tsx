import { SettingsPage } from "@workspace/ui/components/settings-shell";
import { ShieldCheck, UserRound } from "lucide-react";
import { DashboardTile } from "../../dashboard/_components/dashboard-tile";

export default function AccountSettingsPage() {
	return (
		<SettingsPage
			description="Manage your personal profile and how you sign in."
			title="Account settings"
		>
			<div className="grid gap-5 md:grid-cols-2">
				<DashboardTile
					description="Edit your name and view your sign-in email."
					href="/settings/account/profile"
					icon={UserRound}
					title="Profile"
				/>
				<DashboardTile
					description="Review your signed-in devices and manage your password."
					href="/settings/account/security"
					icon={ShieldCheck}
					title="Security"
				/>
			</div>
		</SettingsPage>
	);
}
