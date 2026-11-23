import { SettingsPage } from "@workspace/ui/components/settings-shell";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Account profile" };

export default function ProfilePage() {
	return (
		<SettingsPage
			description="Choose the name people see across your workspaces."
			title="Personal profile"
		>
			<ProfileForm />
		</SettingsPage>
	);
}
