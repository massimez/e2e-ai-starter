import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { AiWorkspaceClient } from "./_components/ai-workspace-client";

export const metadata: Metadata = {
	description:
		"Tenant-scoped Mastra AI assistant with pluggable model providers and pgvector memory.",
	title: "AI Assistant | Dashboard",
};

export default async function DashboardAiPage() {
	const session = await getServerSession();
	if (!session?.user) {
		redirect("/?auth=signin&callbackUrl=/dashboard/ai");
	}

	return (
		<div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
			<AiWorkspaceClient />
		</div>
	);
}
