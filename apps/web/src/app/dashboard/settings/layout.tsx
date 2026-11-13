import type { ReactNode } from "react";
import { SettingsNav } from "./_components/settings-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
	return (
		<div className="mx-auto max-w-6xl space-y-7 p-6 sm:p-10">
			<SettingsNav />

			<div className="w-full">{children}</div>
		</div>
	);
}
