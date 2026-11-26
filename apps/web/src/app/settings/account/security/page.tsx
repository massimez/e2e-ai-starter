import { SettingsPage } from "@workspace/ui/components/settings-shell";
import { ActiveSessions } from "./active-sessions";
import { PasswordSection } from "./password-section";
import { TwoFactorSection } from "./two-factor-section";

export const metadata = { title: "Account security" };

export default function SecuritySettingsPage() {
	return (
		<SettingsPage
			description="Manage two-factor authentication, signed-in devices, and your account password."
			title="Security"
		>
			<TwoFactorSection />
			<ActiveSessions />
			<PasswordSection />
		</SettingsPage>
	);
}
