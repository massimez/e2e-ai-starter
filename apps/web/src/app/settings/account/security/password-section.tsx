"use client";

import { Button } from "@workspace/ui/components/button";
import {
	SettingsSection,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { useAuthModal } from "@/providers/auth-provider";

export function PasswordSection() {
	const { openPasswordReset } = useAuthModal();
	return (
		<SettingsSection>
			<SettingsSectionHeader
				action={
					<Button onClick={openPasswordReset} size="sm" variant="outline">
						Reset password
					</Button>
				}
				description="Use a code sent to your sign-in email to reset your password."
				title="Password"
			/>
		</SettingsSection>
	);
}
