"use client";

import {
	SettingsPage,
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { useNotificationPreferences } from "@/lib/notification-hooks";
import { PreferenceMatrixContent } from "./_components/preference-matrix-content";
import { PushSettingsSection } from "./_components/push-settings-section";

export default function NotificationSettingsPage() {
	const {
		error,
		isError,
		isLoading,
		pendingKey,
		preferences,
		togglePreference,
	} = useNotificationPreferences();

	return (
		<SettingsPage
			description="Choose which workspace events trigger alerts and manage Web Push delivery for this browser."
			title="Notifications & Delivery"
		>
			<PushSettingsSection />

			<SettingsSection>
				<SettingsSectionHeader
					description="Fine-tune delivery channels per event category."
					title="Channel Preferences"
				/>
				<SettingsSectionContent>
					<PreferenceMatrixContent
						error={error}
						isError={isError}
						isLoading={isLoading}
						onToggle={togglePreference}
						pendingKey={pendingKey}
						preferences={preferences}
					/>
				</SettingsSectionContent>
			</SettingsSection>
		</SettingsPage>
	);
}
