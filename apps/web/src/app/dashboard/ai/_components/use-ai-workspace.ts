"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	AiAgentsResponse,
	AiModelOption,
	AiThreadDetailResponse,
	AiThreadsResponse,
} from "@workspace/ai-core/contracts";
import {
	client,
	type InferResponseType,
	parseApiResponse,
} from "@/lib/api-client";
import { organizationKeys, orgHeadersInit } from "@/lib/organization-hooks";

export type WorkspaceWallet = InferResponseType<
	typeof client.api.organizations.current.wallet.$get,
	200
>["data"];

export function createThreadId(): string {
	return crypto.randomUUID();
}

export function syncThreadQueryParam(threadId: string | null) {
	if (typeof window === "undefined") {
		return;
	}
	const url = new URL(window.location.href);
	if (threadId) {
		url.searchParams.set("thread", threadId);
	} else {
		url.searchParams.delete("thread");
	}
	window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function resolveAgentStatus({
	data,
	isError,
	isPending,
}: {
	data: AiAgentsResponse | undefined;
	isError: boolean;
	isPending: boolean;
}) {
	if (isError) {
		return {
			apiKeyEnvVars: [],
			availableModels: [] as AiModelOption[],
			defaultAgentId: "workspace-assistant",
			isConfigured: false,
			modelLabel: "Status unavailable",
			providerLabel: "AI provider",
			semanticRecall: false,
		};
	}

	if (!data) {
		return {
			apiKeyEnvVars: [],
			availableModels: [] as AiModelOption[],
			defaultAgentId: "workspace-assistant",
			isConfigured: false,
			modelLabel: isPending ? "Checking model..." : "Not configured",
			providerLabel: "AI provider",
			semanticRecall: false,
		};
	}

	return {
		apiKeyEnvVars: data.provider.apiKeyEnvVars,
		availableModels: data.availableModels ?? [],
		defaultAgentId: data.defaultAgentId,
		isConfigured: data.configured,
		modelLabel: data.model,
		providerLabel: data.provider.label,
		semanticRecall: data.semanticRecall,
	};
}

export function useAiWorkspaceData({
	activeOrgId,
	activeThreadId,
	canReadWallet,
	currentUserId,
	onDeletedActiveThread,
	page,
	selectedExistingThreadId,
}: {
	activeOrgId: string | undefined;
	activeThreadId: string | null;
	canReadWallet: boolean;
	currentUserId: string | undefined;
	onDeletedActiveThread: () => void;
	page: number;
	selectedExistingThreadId: string | null;
}) {
	const queryClient = useQueryClient();
	const orgScope = activeOrgId ?? "none";

	const walletQuery = useQuery({
		enabled: Boolean(activeOrgId && currentUserId && canReadWallet),
		queryFn: async () =>
			parseApiResponse<WorkspaceWallet>(
				await client.api.organizations.current.wallet.$get(
					{},
					orgHeadersInit(activeOrgId)
				)
			),
		queryKey: organizationKeys.wallet(orgScope, currentUserId),
	});

	const invalidateWallet = () => {
		void queryClient.invalidateQueries({
			queryKey: organizationKeys.wallet(orgScope),
		});
	};

	const agentsQuery = useQuery<AiAgentsResponse>({
		enabled: Boolean(activeOrgId),
		queryFn: async () =>
			parseApiResponse<AiAgentsResponse>(
				await client.api.ai.agents.$get(undefined, orgHeadersInit(activeOrgId))
			),
		queryKey: ["ai", "agents", orgScope],
		staleTime: 60_000,
	});

	const threadsQuery = useQuery<AiThreadsResponse>({
		enabled: Boolean(activeOrgId),
		queryFn: async () =>
			parseApiResponse<AiThreadsResponse>(
				await client.api.ai.threads.$get(
					{ query: { limit: "20", page: String(page) } },
					orgHeadersInit(activeOrgId)
				)
			),
		queryKey: ["ai", "threads", orgScope, page],
	});

	const threadDetailQuery = useQuery<AiThreadDetailResponse>({
		enabled: Boolean(activeOrgId && selectedExistingThreadId),
		queryFn: async () => {
			if (!selectedExistingThreadId) {
				throw new Error("No thread selected");
			}
			return parseApiResponse<AiThreadDetailResponse>(
				await client.api.ai.threads[":id"].$get(
					{ param: { id: selectedExistingThreadId } },
					orgHeadersInit(activeOrgId)
				)
			);
		},
		queryKey: ["ai", "thread", orgScope, selectedExistingThreadId ?? "none"],
	});

	const deleteThreadMutation = useMutation<
		{ deleted: boolean; id: string },
		Error,
		string
	>({
		mutationFn: async (threadIdToDelete) => {
			const response = await client.api.ai.threads[":id"].$delete(
				{ param: { id: threadIdToDelete } },
				orgHeadersInit(activeOrgId)
			);
			return parseApiResponse<{ deleted: boolean; id: string }>(response);
		},
		onSuccess: (_data, deletedId) => {
			void queryClient.invalidateQueries({
				queryKey: ["ai", "threads", orgScope],
			});
			queryClient.removeQueries({
				queryKey: ["ai", "thread", orgScope, deletedId],
			});
			if (
				selectedExistingThreadId === deletedId ||
				activeThreadId === deletedId
			) {
				onDeletedActiveThread();
			}
		},
	});

	const invalidateConversation = () => {
		void queryClient.invalidateQueries({
			queryKey: ["ai", "threads", orgScope],
		});
		if (activeThreadId) {
			void queryClient.invalidateQueries({
				queryKey: ["ai", "thread", orgScope, activeThreadId],
			});
		}
	};

	const invalidateThreadsList = () => {
		void queryClient.invalidateQueries({
			queryKey: ["ai", "threads", orgScope],
		});
	};

	return {
		agentsQuery,
		deleteThreadMutation,
		invalidateConversation,
		invalidateThreadsList,
		invalidateWallet,
		isWalletError: walletQuery.isError,
		threadDetailQuery,
		threadsQuery,
		wallet: walletQuery.data,
	};
}
