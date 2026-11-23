import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { getServerSession } from "@/lib/auth-server";

export const metadata = {
	title: "Settings",
	robots: { index: false, follow: false },
};

export default async function AccountSettingsLayout({
	children,
}: {
	children: ReactNode;
}) {
	if (!(await getServerSession())) {
		redirect("/?auth=signin&callbackUrl=/settings");
	}
	return (
		<>
			<SiteHeader />
			<main className="outline-none" id="main-content" tabIndex={-1}>
				{children}
			</main>
		</>
	);
}
