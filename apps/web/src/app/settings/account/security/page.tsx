import { SettingsPage } from "@workspace/ui/components/settings-shell";
import { ActiveSessions } from "./active-sessions";
import { PasswordSection } from "./password-section";

export const metadata = { title: "Account security" };

export default function SecuritySettingsPage() {
	return (
		<SettingsPage
			description="Manage your signed-in devices and account password."
			title="Security"
		>
			<ActiveSessions />
			<PasswordSection />
		</SettingsPage>
	);
}
