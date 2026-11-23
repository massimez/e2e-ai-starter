import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings-nav";

export default function AccountSettingsLayout({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<div className="mx-auto w-full max-w-6xl space-y-7 px-4 py-8 sm:px-6 sm:py-10">
			<SettingsNav scope="account" />
			{children}
		</div>
	);
}
