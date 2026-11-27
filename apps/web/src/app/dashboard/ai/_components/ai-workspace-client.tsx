"use client";

import type { UIMessage } from "ai";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getSessionImpersonatedBy } from "@/lib/auth-client";
import { useCurrentOrganization } from "@/lib/organization-hooks";
import { AiChatSessionPane } from "./ai-chat-pane";
import {
	ThreadHistorySidebar,
	WorkspaceBriefCard,
	WorkspaceWalletCard,
} from "./ai-sidebar-cards";
import {
	AiWorkspaceBanner,
	ThreadErrorCard,
	ThreadLoadingCard,
} from "./ai-workspace-banner";
import {
	createThreadId,
	resolveAgentStatus,
	syncThreadQueryParam,
	useAiWorkspaceData,
} from "./use-ai-workspace";

export function AiWorkspaceClient() {
	const searchParams = useSearchParams();
	const initialUrlThread = searchParams.get("thread")?.trim() || null;

	const {
		activeOrg,
		activeOrgId,
		currentUserRole,
		hasPermission,
		isLoading: orgLoading,
		isPermissionsPending,
		session,
	} = useCurrentOrganization();
	const impersonated = Boolean(getSessionImpersonatedBy(session));

	const [activeThreadId, setActiveThreadId] = useState<string | null>(
		initialUrlThread
	);
	const [selectedExistingThreadId, setSelectedExistingThreadId] = useState<
		string | null
	>(initialUrlThread);
	const [threadPage, setThreadPage] = useState(0);
	const [selectedModelId, setSelectedModelId] = useState("");
	const previousOrgIdRef = useRef<string | undefined>(activeOrgId);

	useEffect(() => {
		if (previousOrgIdRef.current !== activeOrgId) {
			previousOrgIdRef.current = activeOrgId;
			setThreadPage(0);
			setSelectedExistingThreadId(null);
			setActiveThreadId(createThreadId());
			syncThreadQueryParam(null);
			return;
		}
		if (activeThreadId === null) {
			setActiveThreadId(createThreadId());
		}
	}, [activeOrgId, activeThreadId]);

	const handleNewConversation = () => {
		setSelectedExistingThreadId(null);
		setActiveThreadId(createThreadId());
		syncThreadQueryParam(null);
	};

	const handleSelectThread = (threadId: string) => {
		setSelectedExistingThreadId(threadId);
		setActiveThreadId(threadId);
		syncThreadQueryParam(threadId);
	};

	const canReadWallet = Boolean(session?.user.id && hasPermission("ai:read"));
	const {
		agentsQuery,
		deleteThreadMutation,
		invalidateConversation,
		invalidateThreadsList,
		invalidateWallet,
		isWalletError,
		threadDetailQuery,
		threadsQuery,
		wallet,
	} = useAiWorkspaceData({
		activeOrgId,
		activeThreadId,
		canReadWallet,
		currentUserId: session?.user.id,
		onDeletedActiveThread: handleNewConversation,
		page: threadPage,
		selectedExistingThreadId,
	});

	const isRoleResolved =
		!(orgLoading || isPermissionsPending) && currentUserRole !== null;
	const canExecuteAi = !impersonated && hasPermission("ai:execute");
	const agentStatus = resolveAgentStatus({
		data: agentsQuery.data,
		isError: agentsQuery.isError,
		isPending: agentsQuery.isPending,
	});
	const loadedMessages =
		selectedExistingThreadId && threadDetailQuery.data
			? (threadDetailQuery.data.messages as unknown as UIMessage[])
			: [];

	const workspaceKey = `${session?.user.id ?? "anonymous"}:${activeOrgId ?? "none"}`;
	const sessionKey = `${workspaceKey}:${activeThreadId ?? "initializing"}`;

	const renderMainChatPane = () => {
		if (
			!activeThreadId ||
			(selectedExistingThreadId && threadDetailQuery.isPending)
		) {
			return <ThreadLoadingCard />;
		}
		if (
			selectedExistingThreadId &&
			threadDetailQuery.isError &&
			!threadDetailQuery.data
		) {
			return (
				<ThreadErrorCard
					errorMessage={threadDetailQuery.error.message}
					onNewConversation={handleNewConversation}
					onRetry={() => {
						void threadDetailQuery.refetch();
					}}
				/>
			);
		}
		return (
			<AiChatSessionPane
				activeOrgId={activeOrgId}
				activeOrgName={activeOrg?.name ?? null}
				agentId={agentStatus.defaultAgentId}
				apiKeyEnvVars={agentStatus.apiKeyEnvVars}
				canExecuteAi={canExecuteAi}
				initialMessages={loadedMessages}
				isConfigured={agentStatus.isConfigured}
				isImpersonated={impersonated}
				isRoleResolved={isRoleResolved}
				isStatusPending={agentsQuery.isPending}
				key={sessionKey}
				modelId={selectedModelId || undefined}
				onConversationFinished={invalidateConversation}
				onThreadTitleGenerated={invalidateThreadsList}
				providerLabel={agentStatus.providerLabel}
				statusError={agentsQuery.isError ? agentsQuery.error.message : null}
				threadDetailUpdatedAt={
					selectedExistingThreadId && threadDetailQuery.data
						? threadDetailQuery.dataUpdatedAt
						: 0
				}
				threadId={activeThreadId}
			/>
		);
	};

	return (
		<div className="flex flex-col gap-6">
			<AiWorkspaceBanner
				availableModels={agentStatus.availableModels}
				modelLabel={agentStatus.modelLabel}
				onNewConversation={handleNewConversation}
				onSelectModel={setSelectedModelId}
				selectedModelId={selectedModelId}
				semanticRecall={agentStatus.semanticRecall}
			/>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
				<div className="order-2 flex flex-col gap-4 lg:order-1">
					{canReadWallet ? (
						<WorkspaceWalletCard isError={isWalletError} wallet={wallet} />
					) : null}
					<ThreadHistorySidebar
						activeThreadId={activeThreadId}
						canDeleteThreads={canExecuteAi}
						deleteError={
							deleteThreadMutation.isError
								? deleteThreadMutation.error.message
								: null
						}
						deletingThreadId={
							deleteThreadMutation.isPending
								? (deleteThreadMutation.variables ?? null)
								: null
						}
						hasMore={threadsQuery.data?.hasMore ?? false}
						isError={threadsQuery.isError}
						isPending={threadsQuery.isPending}
						onDeleteThread={(threadIdToDelete) =>
							deleteThreadMutation.mutate(threadIdToDelete)
						}
						onPageChange={setThreadPage}
						onSelectThread={handleSelectThread}
						page={threadPage}
						threads={threadsQuery.data?.threads ?? []}
					/>
					<WorkspaceBriefCard
						activeOrgId={activeOrgId}
						canExecuteAi={!impersonated && (!isRoleResolved || canExecuteAi)}
						creditCost={wallet?.prices.workspace_brief}
						isConfigured={agentStatus.isConfigured}
						key={workspaceKey}
						modelId={selectedModelId || undefined}
						onSettled={invalidateWallet}
					/>
				</div>

				<div className="order-1 min-w-0 lg:order-2">{renderMainChatPane()}</div>
			</div>
		</div>
	);
}
