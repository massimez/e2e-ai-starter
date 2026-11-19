"use client";

import { useMutation } from "@tanstack/react-query";
import type {
	AiThreadsResponse,
	WorkspaceBriefResponse,
} from "@workspace/ai-core/contracts";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@workspace/ui/components/card";
import { DeleteConfirmationDialog } from "@workspace/ui/components/delete-confirmation-dialog";
import {
	ChevronLeft,
	ChevronRight,
	Loader2,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { client, parseApiResponse } from "@/lib/api-client";
import { formatUtcDate } from "@/lib/format";
import { orgHeadersInit } from "@/lib/organization-hooks";
import { renderSafeMarkdown } from "./markdown-renderer";

export interface ThreadHistorySidebarProps {
	activeThreadId: string | null;
	deleteError: string | null;
	deletingThreadId: string | null;
	hasMore: boolean;
	isError: boolean;
	isPending: boolean;
	onDeleteThread: (threadId: string) => void;
	onPageChange: (nextPage: number) => void;
	onSelectThread: (threadId: string) => void;
	page: number;
	threads: AiThreadsResponse["threads"];
}

export function ThreadHistorySidebar({
	activeThreadId,
	deleteError,
	deletingThreadId,
	hasMore,
	isError,
	isPending,
	onDeleteThread,
	onPageChange,
	onSelectThread,
	page,
	threads,
}: ThreadHistorySidebarProps) {
	const [threadToDelete, setThreadToDelete] = useState<{
		id: string;
		title: string;
	} | null>(null);

	let body = (
		<ul className="max-h-72 space-y-1 overflow-y-auto overscroll-contain">
			{threads.map((thread) => {
				const isSelected = activeThreadId === thread.id;
				const title = thread.title?.trim() || "Untitled conversation";
				const isDeleting = deletingThreadId === thread.id;
				return (
					<li className="group flex items-center gap-1" key={thread.id}>
						<button
							aria-current={isSelected ? "true" : undefined}
							className={`focus-visible:ring-ring min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none ${
								isSelected
									? "bg-primary/10 text-primary font-medium"
									: "text-foreground hover:bg-muted/60"
							}`}
							onClick={() => onSelectThread(thread.id)}
							type="button"
						>
							<div className="truncate">{title}</div>
							<div className="text-muted-foreground mt-0.5 text-[10px]">
								{formatUtcDate(thread.updatedAt)}
							</div>
						</button>
						<Button
							aria-label={`Delete conversation: ${title}`}
							className="text-muted-foreground hover:text-destructive size-8 shrink-0"
							disabled={isDeleting}
							onClick={() => setThreadToDelete({ id: thread.id, title })}
							size="icon"
							type="button"
							variant="ghost"
						>
							{isDeleting ? (
								<Loader2
									aria-hidden="true"
									className="h-3.5 w-3.5 animate-spin"
								/>
							) : (
								<Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
							)}
						</Button>
					</li>
				);
			})}
		</ul>
	);

	if (isPending) {
		body = (
			<div className="text-muted-foreground flex items-center gap-2 px-2 py-4 text-xs">
				<Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
				<span>Loading threads...</span>
			</div>
		);
	} else if (isError) {
		body = (
			<p className="text-muted-foreground px-2 py-4 text-xs">
				Could not load thread history.
			</p>
		);
	} else if (threads.length === 0) {
		body = (
			<p className="text-muted-foreground px-2 py-4 text-xs leading-relaxed">
				No saved threads yet. Start a conversation to create your first thread.
			</p>
		);
	}

	return (
		<aside aria-label="Conversation history">
			<Card className="border-border/60 bg-card/70 gap-0 py-0 shadow-xs backdrop-blur-xs">
				<CardHeader className="border-border/60 flex flex-row items-center justify-between border-b px-4 py-3.5">
					<CardTitle className="text-sm font-semibold">
						Recent Threads
					</CardTitle>
					{page > 0 || hasMore ? (
						<div className="flex items-center gap-1">
							<Button
								aria-label="Previous thread page"
								className="size-6"
								disabled={page <= 0 || isPending}
								onClick={() => onPageChange(Math.max(0, page - 1))}
								size="icon"
								type="button"
								variant="ghost"
							>
								<ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
							</Button>
							<span className="text-muted-foreground text-[10px]">
								{page + 1}
							</span>
							<Button
								aria-label="Next thread page"
								className="size-6"
								disabled={!hasMore || isPending}
								onClick={() => onPageChange(page + 1)}
								size="icon"
								type="button"
								variant="ghost"
							>
								<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
							</Button>
						</div>
					) : null}
				</CardHeader>
				<CardContent className="space-y-2 p-2">
					{deleteError ? (
						<p className="text-destructive px-2 pt-1 text-[11px]" role="alert">
							{deleteError}
						</p>
					) : null}
					{body}
				</CardContent>
			</Card>

			<DeleteConfirmationDialog
				confirmLabel="Delete Thread"
				description={`Are you sure you want to permanently delete "${threadToDelete?.title ?? ""}" and its message history?`}
				onConfirm={() => {
					if (threadToDelete) {
						onDeleteThread(threadToDelete.id);
						setThreadToDelete(null);
					}
				}}
				onOpenChange={(open) => {
					if (!open) {
						setThreadToDelete(null);
					}
				}}
				open={Boolean(threadToDelete)}
				title="Delete Conversation Thread"
			/>
		</aside>
	);
}

export interface WorkspaceBriefCardProps {
	activeOrgId?: string;
	canExecuteAi: boolean;
	isConfigured: boolean;
	modelId?: string;
}

export function WorkspaceBriefCard({
	activeOrgId,
	canExecuteAi,
	isConfigured,
	modelId,
}: WorkspaceBriefCardProps) {
	const briefMutation = useMutation<WorkspaceBriefResponse, Error>({
		mutationFn: async () =>
			parseApiResponse<WorkspaceBriefResponse>(
				await client.api.ai.workflows["workspace-brief"].$post(
					{ json: { ...(modelId ? { modelId } : {}) } },
					orgHeadersInit(activeOrgId)
				)
			),
	});

	const { data } = briefMutation;

	return (
		<Card className="border-border/60 bg-card/70 gap-0 py-0 shadow-xs backdrop-blur-xs">
			<CardHeader className="border-border/60 flex flex-row items-center justify-between border-b px-4 py-3">
				<CardTitle className="text-sm font-semibold">
					Workspace Summary
				</CardTitle>
				<Badge appearance="light" size="sm" variant="secondary">
					Structured report
				</Badge>
			</CardHeader>
			<CardContent className="space-y-3 p-3.5 text-xs">
				<p className="text-muted-foreground leading-relaxed">
					Synthesizes workspace members, stored files, and quota health into a
					structured executive brief.
				</p>
				<Button
					className="w-full"
					disabled={!(isConfigured && canExecuteAi) || briefMutation.isPending}
					onClick={() => briefMutation.mutate()}
					size="sm"
					type="button"
					variant="outline"
				>
					{briefMutation.isPending ? (
						<Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
					) : (
						<Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
					)}
					{briefMutation.isPending
						? "Generating report..."
						: "Generate Summary"}
				</Button>
				{briefMutation.isError ? (
					<p className="text-destructive text-[11px] leading-relaxed">
						{briefMutation.error.message}
					</p>
				) : null}
				{data ? (
					<div className="border-border/60 bg-muted/40 space-y-2.5 rounded-lg border p-2.5 text-[11px]">
						<div className="text-foreground font-medium">
							{data.metrics.organizationName} ({data.metrics.memberCount}{" "}
							members, {data.metrics.committedUploadCount} files)
						</div>
						<div className="text-muted-foreground space-y-1.5 text-xs leading-relaxed">
							{renderSafeMarkdown(data.summary, "workspace-brief")}
						</div>
						{data.highlights && data.highlights.length > 0 ? (
							<div className="space-y-1 pt-1">
								<div className="text-foreground font-medium">Highlights</div>
								<ul className="text-muted-foreground list-disc space-y-0.5 pl-4">
									{data.highlights.map((item) => (
										<li key={item}>{item}</li>
									))}
								</ul>
							</div>
						) : null}
						{data.risks && data.risks.length > 0 ? (
							<div className="space-y-1 pt-1">
								<div className="text-foreground font-medium">Risks</div>
								<ul className="text-muted-foreground list-disc space-y-0.5 pl-4">
									{data.risks.map((item) => (
										<li key={item}>{item}</li>
									))}
								</ul>
							</div>
						) : null}
						{data.recommendedActions && data.recommendedActions.length > 0 ? (
							<div className="space-y-1 pt-1">
								<div className="text-foreground font-medium">
									Recommended Actions
								</div>
								<ul className="text-muted-foreground list-disc space-y-0.5 pl-4">
									{data.recommendedActions.map((item) => (
										<li key={item}>{item}</li>
									))}
								</ul>
							</div>
						) : null}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
