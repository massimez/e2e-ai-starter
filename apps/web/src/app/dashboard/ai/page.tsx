import {
	dehydrate,
	HydrationBoundary,
	QueryClient,
} from "@tanstack/react-query";
import type {
	AiAgentsResponse,
	AiThreadsResponse,
} from "@workspace/ai-core/contracts";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
	fetchInternalApiData,
	getServerDefaultOrganizationId,
	getServerSession,
} from "@/lib/auth-server";
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

	const activeOrgId =
		session.session.activeOrganizationId ??
		(await getServerDefaultOrganizationId());
	const queryClient = new QueryClient();

	if (activeOrgId) {
		const [agents, threads] = await Promise.all([
			fetchInternalApiData<AiAgentsResponse>("/api/ai/agents", activeOrgId),
			fetchInternalApiData<AiThreadsResponse>(
				"/api/ai/threads?limit=20&page=0",
				activeOrgId
			),
		]);
		if (agents) {
			queryClient.setQueryData(["ai", "agents", activeOrgId], agents);
		}
		if (threads) {
			queryClient.setQueryData(["ai", "threads", activeOrgId], threads);
		}
	}

	return (
		<div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
			<HydrationBoundary state={dehydrate(queryClient)}>
				<AiWorkspaceClient />
			</HydrationBoundary>
		</div>
	);
}
