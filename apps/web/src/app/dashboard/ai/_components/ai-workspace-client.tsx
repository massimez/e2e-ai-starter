"use client";

import { useChat } from "@ai-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	AiAgentsResponse,
	AiThreadDetailResponse,
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
import {
	DefaultChatTransport,
	getToolName,
	isToolUIPart,
	type UIMessage,
} from "ai";
import {
	AlertCircle,
	ArrowLeft,
	Bot,
	Loader2,
	MessageSquarePlus,
	RefreshCw,
	Send,
	Sparkles,
	Square,
	Trash2,
	Wrench,
} from "lucide-react";
import Link from "next/link";
import {
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { client, parseApiResponse } from "@/lib/api-client";
import { formatUtcDate } from "@/lib/format";
import {
	orgHeadersInit,
	useCurrentOrganization,
} from "@/lib/organization-hooks";
import { renderSafeMarkdown } from "./markdown-renderer";

const STARTER_PROMPTS = [
	"Summarize my active workspace, role, and storage quota usage.",
	"List the members and roles in this workspace.",
	"Search committed files in our workspace storage.",
] as const;

const TOOL_LABELS: Record<string, string> = {
	"get-workspace-context": "Workspace context",
	"list-workspace-members": "Team members",
	"search-workspace-files": "Workspace files",
	workspaceContextTool: "Workspace context",
	workspaceFilesTool: "Workspace files",
	workspaceMembersTool: "Team members",
};

const TOOL_STATE_LABELS: Record<string, string> = {
	"approval-requested": "Awaiting approval",
	"approval-responded": "Approved",
	"input-available": "Running",
	"input-streaming": "Running",
	"output-available": "Done",
	"output-denied": "Declined",
	"output-error": "Error",
};

const TOOL_SPLIT_PATTERN = /[-_]+/u;

function createThreadId(): string {
	return crypto.randomUUID();
}

function formatToolLabel(rawName: string): string {
	return (
		TOOL_LABELS[rawName] ??
		rawName
			.split(TOOL_SPLIT_PATTERN)
			.filter(Boolean)
			.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
			.join(" ")
	);
}

function formatToolState(state: string): string {
	return TOOL_STATE_LABELS[state] ?? state;
}

function sanitizeLatestUserMessage(messages: UIMessage[]) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const candidate = messages[index];
		if (candidate?.role !== "user") {
			continue;
		}
		const textParts = candidate.parts.flatMap((part) => {
			if (part.type !== "text" || part.text.trim().length === 0) {
				return [];
			}
			return [
				{
					text: part.text,
					type: "text" as const,
					...(part.state === "done" || part.state === "streaming"
						? { state: part.state }
						: {}),
				},
			];
		});
		if (textParts.length === 0) {
			continue;
		}
		return [
			{
				...(candidate.id ? { id: candidate.id } : {}),
				parts: textParts,
				role: "user" as const,
			},
		];
	}
	return [];
}

function AssistantConfigNotice({
	apiKeyEnvVars,
	isConfigured,
	isStatusPending,
	providerLabel,
	statusError,
}: {
	apiKeyEnvVars: string[];
	isConfigured: boolean;
	isStatusPending: boolean;
	providerLabel: string;
	statusError: string | null;
}) {
	if (statusError) {
		return (
			<div
				className="border-destructive/30 bg-destructive/10 text-destructive mx-5 mt-4 flex items-start gap-2.5 rounded-lg border p-3.5 text-xs"
				role="alert"
			>
				<AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
				<div className="space-y-0.5">
					<p className="font-medium">Could not verify AI assistant status</p>
					<p className="wrap-break-word">{statusError}</p>
				</div>
			</div>
		);
	}

	if (isStatusPending || isConfigured) {
		return null;
	}

	return (
		<div
			className="border-border bg-muted/40 mx-5 mt-4 flex items-start gap-2.5 rounded-lg border p-3.5 text-xs"
			role="status"
		>
			<AlertCircle
				aria-hidden="true"
				className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0"
			/>
			<div className="space-y-1">
				<p className="text-foreground font-medium">
					{providerLabel} API key not configured
				</p>
				<p className="text-muted-foreground leading-relaxed">
					Set{" "}
					{apiKeyEnvVars.length > 0 ? (
						<code className="font-mono">{apiKeyEnvVars.join(" or ")}</code>
					) : (
						"the provider API key"
					)}{" "}
					in your root <code className="font-mono">.env</code> file (or change{" "}
					<code className="font-mono">MASTRA_DEFAULT_MODEL</code>) and restart
					the API service to enable live chat responses.
				</p>
			</div>
		</div>
	);
}

interface AiChatSessionPaneProps {
	activeOrgId?: string;
	activeOrgName: string | null;
	agentId: string;
	apiKeyEnvVars: string[];
	canExecuteAi: boolean;
	initialMessages: UIMessage[];
	isConfigured: boolean;
	isRoleResolved: boolean;
	isStatusPending: boolean;
	onConversationFinished: () => void;
	onThreadTitleGenerated: () => void;
	providerLabel: string;
	statusError: string | null;
	threadDetailUpdatedAt: number;
	threadId: string | null;
}

function AiChatSessionPane({
	activeOrgId,
	activeOrgName,
	agentId,
	apiKeyEnvVars,
	canExecuteAi,
	initialMessages,
	isConfigured,
	isRoleResolved,
	isStatusPending,
	onConversationFinished,
	onThreadTitleGenerated,
	providerLabel,
	statusError,
	threadDetailUpdatedAt,
	threadId,
}: AiChatSessionPaneProps) {
	const [input, setInput] = useState("");
	const [liveAnnouncement, setLiveAnnouncement] = useState("");
	const isNearBottomRef = useRef<boolean>(true);
	const lastSyncedAtRef = useRef(0);
	const messagesScrollRef = useRef<HTMLDivElement | null>(null);
	const scrollBottomRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	const transport = useMemo(
		() =>
			new DefaultChatTransport<UIMessage>({
				api: "/api/ai/chat",
				body: { agentId },
				credentials: "include",
				...(activeOrgId
					? { headers: { "x-organization-id": activeOrgId } }
					: {}),
				prepareSendMessagesRequest: ({
					body,
					id,
					messages: outgoingMessages,
					trigger,
				}) => ({
					body: {
						...(body ?? {}),
						id,
						messages: sanitizeLatestUserMessage(outgoingMessages),
						...(trigger === "submit-message" ? { trigger } : {}),
					},
				}),
			}),
		[activeOrgId, agentId]
	);

	const { error, messages, sendMessage, setMessages, status, stop } =
		useChat<UIMessage>({
			id: threadId ?? "pending",
			messages: initialMessages,
			onData: (dataPart) => {
				if (dataPart.type === "data-thread-title") {
					onThreadTitleGenerated();
				}
			},
			onError: (err) => {
				setLiveAnnouncement(`Assistant request failed: ${err.message}`);
			},
			onFinish: ({ isAbort }) => {
				if (isAbort) {
					setLiveAnnouncement("Assistant response stopped.");
					onConversationFinished();
					return;
				}
				setLiveAnnouncement("Assistant response complete.");
				onConversationFinished();
			},
			transport,
		});

	const isStreaming = status === "submitted" || status === "streaming";
	const isInputDisabled =
		!(threadId && isConfigured) || (isRoleResolved && !canExecuteAi);
	const canSubmit =
		!(isInputDisabled || isStreaming) && input.trim().length > 0;

	useEffect(() => {
		if (
			isStreaming ||
			threadDetailUpdatedAt <= 0 ||
			threadDetailUpdatedAt === lastSyncedAtRef.current
		) {
			return;
		}
		lastSyncedAtRef.current = threadDetailUpdatedAt;
		setMessages(initialMessages);
	}, [initialMessages, isStreaming, setMessages, threadDetailUpdatedAt]);

	useEffect(() => {
		if (messages.length === 0 && !isStreaming) {
			return;
		}
		if (!isNearBottomRef.current) {
			return;
		}
		const target = scrollBottomRef.current;
		if (!target) {
			return;
		}
		const prefersReduced =
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		target.scrollIntoView({
			behavior: isStreaming || prefersReduced ? "auto" : "smooth",
			block: "end",
		});
	}, [isStreaming, messages]);

	const handleMessagesScroll = () => {
		const container = messagesScrollRef.current;
		if (!container) {
			return;
		}
		const distanceToBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight;
		isNearBottomRef.current = distanceToBottom < 80;
	};

	const handleSubmitPrompt = async () => {
		const trimmed = input.trim();
		if (!(trimmed && threadId) || isStreaming) {
			return;
		}
		isNearBottomRef.current = true;
		setInput("");
		setLiveAnnouncement("Assistant responding.");
		try {
			await sendMessage({ text: trimmed });
		} catch {
			setInput((current) => (current ? current : trimmed));
		}
	};

	const handleFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		await handleSubmitPrompt();
	};

	const handleTextareaKeyDown = async (
		event: KeyboardEvent<HTMLTextAreaElement>
	) => {
		if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
			return;
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			if (canSubmit) {
				await handleSubmitPrompt();
			}
		}
	};

	return (
		<Card className="border-border/60 bg-card/80 flex h-[calc(100dvh-14rem)] max-h-192 min-h-120 flex-col gap-0 overflow-hidden py-0 shadow-xs backdrop-blur-xs">
			<CardHeader className="border-border/60 flex flex-row items-center justify-between gap-3 border-b px-5 py-3.5">
				<div className="min-w-0">
					<CardTitle className="flex items-center gap-2 text-sm font-semibold">
						<Bot aria-hidden="true" className="text-primary h-4 w-4 shrink-0" />
						<span className="truncate">
							{activeOrgName
								? `${activeOrgName} Assistant`
								: "Workspace Assistant"}
						</span>
					</CardTitle>
				</div>
				<div className="flex items-center gap-2">
					{isStreaming ? (
						<Badge appearance="light" size="sm" variant="info">
							Streaming
						</Badge>
					) : (
						<Badge appearance="light" size="sm" variant="secondary">
							Ready
						</Badge>
					)}
				</div>
			</CardHeader>

			<CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0">
				<div aria-live="polite" className="sr-only">
					{liveAnnouncement}
				</div>

				<AssistantConfigNotice
					apiKeyEnvVars={apiKeyEnvVars}
					isConfigured={isConfigured}
					isStatusPending={isStatusPending}
					providerLabel={providerLabel}
					statusError={statusError}
				/>

				{isRoleResolved && !canExecuteAi ? (
					<div
						className="border-border bg-muted/40 mx-5 mt-4 flex items-start gap-2.5 rounded-lg border p-3.5 text-xs"
						role="status"
					>
						<AlertCircle
							aria-hidden="true"
							className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0"
						/>
						<p className="text-muted-foreground leading-relaxed">
							Your current workspace role has read-only AI access. Ask an admin
							to grant member or higher access to send prompts.
						</p>
					</div>
				) : null}

				{error ? (
					<div
						className="border-destructive/30 bg-destructive/10 text-destructive mx-5 mt-4 flex items-start gap-2.5 rounded-lg border p-3.5 text-xs"
						role="alert"
					>
						<AlertCircle
							aria-hidden="true"
							className="mt-0.5 h-4 w-4 shrink-0"
						/>
						<div className="min-w-0 space-y-0.5">
							<p className="font-medium">Unable to complete AI request</p>
							<p className="wrap-break-word">{error.message}</p>
						</div>
					</div>
				) : null}

				<div
					className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5"
					onScroll={handleMessagesScroll}
					ref={messagesScrollRef}
				>
					{messages.length === 0 ? (
						<div className="flex h-full min-h-64 flex-col items-center justify-center gap-5 py-6 text-center">
							<div className="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-2xl">
								<Sparkles aria-hidden="true" className="h-6 w-6" />
							</div>
							<div className="max-w-md space-y-1.5">
								<h2 className="text-foreground text-base font-semibold">
									Ask about your active workspace
								</h2>
								<p className="text-muted-foreground text-xs leading-relaxed">
									Conversations stay scoped to your active workspace and can
									search saved files, members, and earlier messages.
								</p>
							</div>
							<div className="flex max-w-xl flex-wrap items-center justify-center gap-2">
								{STARTER_PROMPTS.map((prompt) => (
									<Button
										disabled={isInputDisabled || isStreaming}
										key={prompt}
										onClick={() => {
											setInput(prompt);
											textareaRef.current?.focus();
										}}
										size="sm"
										type="button"
										variant="outline"
									>
										{prompt}
									</Button>
								))}
							</div>
						</div>
					) : (
						<ul aria-label="Conversation messages" className="space-y-4">
							{messages.map((message) => {
								const isUser = message.role === "user";
								return (
									<li
										className={`flex flex-col gap-1.5 ${
											isUser ? "items-end" : "items-start"
										}`}
										key={message.id}
									>
										<span className="text-muted-foreground px-1 text-[11px] font-medium">
											{isUser ? "You" : "Workspace Assistant"}
										</span>
										<div
											className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
												isUser
													? "bg-primary text-primary-foreground"
													: "border-border/70 bg-muted/40 text-foreground border"
											}`}
										>
											{buildKeyedMessageParts(message).map(({ key, part }) => (
												<ChatMessagePart
													isUser={isUser}
													key={key}
													part={part}
													partKey={key}
												/>
											))}
										</div>
									</li>
								);
							})}
							{status === "submitted" ? (
								<li className="flex flex-col items-start gap-1.5">
									<span className="text-muted-foreground px-1 text-[11px] font-medium">
										Workspace Assistant
									</span>
									<div className="border-border/70 bg-muted/40 text-muted-foreground inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm">
										<Loader2
											aria-hidden="true"
											className="text-primary h-3.5 w-3.5 animate-spin"
										/>
										<span>Thinking...</span>
									</div>
								</li>
							) : null}
						</ul>
					)}
					<div ref={scrollBottomRef} />
				</div>

				<form
					className="border-border/60 bg-background/60 border-t px-5 py-4"
					onSubmit={handleFormSubmit}
				>
					<label className="sr-only" htmlFor="ai-prompt-input">
						Message Workspace Assistant
					</label>
					<div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
						<div className="flex-1 space-y-1.5">
							<textarea
								aria-describedby="ai-prompt-hint"
								className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-14 w-full resize-y rounded-lg border px-3.5 py-2.5 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60"
								disabled={isInputDisabled}
								id="ai-prompt-input"
								onChange={(event) => setInput(event.target.value)}
								onKeyDown={handleTextareaKeyDown}
								placeholder="Ask about workspace quota, members, or organization setup..."
								ref={textareaRef}
								rows={2}
								value={input}
							/>
							<p
								className="text-muted-foreground text-[11px]"
								id="ai-prompt-hint"
							>
								Press Enter to send, Shift + Enter for a new line.
							</p>
						</div>

						<div className="flex shrink-0 items-center justify-end gap-2 sm:pb-5">
							{isStreaming ? (
								<Button
									onClick={() => {
										void stop();
									}}
									size="md"
									type="button"
									variant="outline"
								>
									<Square aria-hidden="true" className="h-3.5 w-3.5" />
									Stop
								</Button>
							) : (
								<Button disabled={!canSubmit} size="md" type="submit">
									<Send aria-hidden="true" className="h-4 w-4" />
									Send
								</Button>
							)}
						</div>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function ChatMessagePart({
	isUser,
	part,
	partKey,
}: {
	isUser: boolean;
	part: UIMessage["parts"][number];
	partKey: string;
}) {
	if (part.type === "text") {
		if (isUser) {
			return <p className="wrap-break-word whitespace-pre-wrap">{part.text}</p>;
		}
		return <>{renderSafeMarkdown(part.text, partKey)}</>;
	}
	if (part.type === "reasoning") {
		if (!part.text.trim()) {
			return null;
		}
		return (
			<details className="border-border/60 bg-background/50 my-1.5 rounded-md border px-2.5 py-1.5 text-xs">
				<summary className="text-muted-foreground cursor-pointer font-medium select-none">
					Reasoning
				</summary>
				<p className="text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-wrap">
					{part.text}
				</p>
			</details>
		);
	}
	if (isToolUIPart(part)) {
		const toolName = getToolName(part);
		return (
			<div className="bg-background/70 border-border/60 my-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]">
				<Wrench aria-hidden="true" className="text-primary h-3 w-3 shrink-0" />
				<span className="font-medium">{formatToolLabel(toolName)}</span>
				<span className="text-muted-foreground">
					{formatToolState(part.state)}
				</span>
			</div>
		);
	}
	return null;
}

function buildKeyedMessageParts(message: UIMessage) {
	const seenCounts = new Map<string, number>();
	return message.parts.map((part) => {
		const rawKey = isToolUIPart(part)
			? `${message.id}-tool-${part.toolCallId}`
			: `${message.id}-${part.type}`;
		const occurrence = (seenCounts.get(rawKey) ?? 0) + 1;
		seenCounts.set(rawKey, occurrence);
		const key = occurrence === 1 ? rawKey : `${rawKey}-${occurrence}`;
		return { key, part };
	});
}

interface ThreadHistorySidebarProps {
	activeThreadId: string | null;
	deleteError: string | null;
	deletingThreadId: string | null;
	isError: boolean;
	isPending: boolean;
	onDeleteThread: (threadId: string) => void;
	onSelectThread: (threadId: string) => void;
	threads: AiThreadsResponse["threads"];
}

function ThreadHistorySidebar({
	activeThreadId,
	deleteError,
	deletingThreadId,
	isError,
	isPending,
	onDeleteThread,
	onSelectThread,
	threads,
}: ThreadHistorySidebarProps) {
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
							onClick={() => onDeleteThread(thread.id)}
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
				<CardHeader className="border-border/60 border-b px-4 py-3.5">
					<CardTitle className="text-sm font-semibold">
						Recent Threads
					</CardTitle>
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
		</aside>
	);
}

interface WorkspaceBriefCardProps {
	activeOrgId?: string;
	canExecuteAi: boolean;
	isConfigured: boolean;
}

function WorkspaceBriefCard({
	activeOrgId,
	canExecuteAi,
	isConfigured,
}: WorkspaceBriefCardProps) {
	const briefMutation = useMutation<WorkspaceBriefResponse, Error>({
		mutationFn: async () =>
			parseApiResponse<WorkspaceBriefResponse>(
				await client.api.ai.workflows["workspace-brief"].$post(
					{ json: {} },
					orgHeadersInit(activeOrgId)
				)
			),
	});

	return (
		<Card className="border-border/60 bg-card/70 gap-0 py-0 shadow-xs backdrop-blur-xs">
			<CardHeader className="border-border/60 flex flex-row items-center justify-between border-b px-4 py-3">
				<CardTitle className="text-sm font-semibold">
					Workspace Summary
				</CardTitle>
				<Badge appearance="light" size="sm" variant="secondary">
					One-click report
				</Badge>
			</CardHeader>
			<CardContent className="space-y-3 p-3.5 text-xs">
				<p className="text-muted-foreground leading-relaxed">
					Summarizes your workspace members, stored files, and activity metrics
					into a concise report.
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
				{briefMutation.data ? (
					<div className="border-border/60 bg-muted/40 space-y-1.5 rounded-lg border p-2.5 text-[11px]">
						<div className="text-foreground font-medium">
							{briefMutation.data.metrics.organizationName} (
							{briefMutation.data.metrics.memberCount} members,{" "}
							{briefMutation.data.metrics.committedUploadCount} files)
						</div>
						<div className="text-muted-foreground space-y-1.5 text-xs leading-relaxed">
							{renderSafeMarkdown(
								briefMutation.data.summary,
								"workspace-brief"
							)}
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function resolveAgentStatus({
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
			defaultAgentId: "workspace-assistant",
			isConfigured: false,
			modelLabel: isPending ? "Checking model..." : "Not configured",
			providerLabel: "AI provider",
			semanticRecall: false,
		};
	}

	return {
		apiKeyEnvVars: data.provider.apiKeyEnvVars,
		defaultAgentId: data.defaultAgentId,
		isConfigured: data.configured,
		modelLabel: data.model,
		providerLabel: data.provider.label,
		semanticRecall: data.semanticRecall,
	};
}

function ThreadErrorCard({
	errorMessage,
	onNewConversation,
	onRetry,
}: {
	errorMessage: string;
	onNewConversation: () => void;
	onRetry: () => void;
}) {
	return (
		<Card className="border-border/60 bg-card/80 flex min-h-120 items-center justify-center p-6 shadow-xs">
			<div className="max-w-md space-y-4 text-center" role="alert">
				<div className="bg-destructive/10 text-destructive mx-auto flex h-11 w-11 items-center justify-center rounded-full">
					<AlertCircle aria-hidden="true" className="h-5 w-5" />
				</div>
				<div className="space-y-1">
					<h2 className="text-foreground text-base font-semibold">
						Could not load conversation
					</h2>
					<p className="text-muted-foreground text-xs leading-relaxed">
						{errorMessage}
					</p>
				</div>
				<div className="flex flex-wrap items-center justify-center gap-2">
					<Button onClick={onRetry} size="sm" type="button" variant="outline">
						<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
						Retry
					</Button>
					<Button onClick={onNewConversation} size="sm" type="button">
						<MessageSquarePlus aria-hidden="true" className="h-3.5 w-3.5" />
						Start New Chat
					</Button>
				</div>
			</div>
		</Card>
	);
}

function ThreadLoadingCard() {
	return (
		<Card className="border-border/60 bg-card/80 flex min-h-120 items-center justify-center shadow-xs">
			<div className="text-muted-foreground flex items-center gap-2 text-sm">
				<Loader2
					aria-hidden="true"
					className="text-primary h-4 w-4 animate-spin"
				/>
				<span>Loading conversation...</span>
			</div>
		</Card>
	);
}

function AiWorkspaceBanner({
	modelLabel,
	onNewConversation,
	semanticRecall,
}: {
	modelLabel: string;
	onNewConversation: () => void;
	semanticRecall: boolean;
}) {
	return (
		<div className="border-border/70 bg-card/70 relative overflow-hidden rounded-2xl border p-6 shadow-xs backdrop-blur-md">
			<div className="from-primary/10 via-primary/5 dark:from-primary/15 pointer-events-none absolute inset-0 bg-linear-to-r to-transparent" />
			<div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="space-y-2">
					<Link
						className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
						href="/dashboard"
					>
						<ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
						Back to Workspace
					</Link>
					<div className="flex flex-wrap items-center gap-2.5">
						<h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
							AI Workspace Assistant
						</h1>
						<Badge appearance="light" size="sm" variant="primary">
							{modelLabel}
						</Badge>
						<Badge appearance="light" size="sm" variant="secondary">
							{semanticRecall ? "Smart Memory" : "Thread Memory"}
						</Badge>
					</div>
					<p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
						Ask questions about your workspace, team members, and stored files.
						Conversations stay private to your active organization.
					</p>
				</div>

				<div className="flex shrink-0 items-center gap-2">
					<Button
						onClick={onNewConversation}
						size="sm"
						type="button"
						variant="outline"
					>
						<MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
						New Chat
					</Button>
				</div>
			</div>
		</div>
	);
}

function useAiWorkspaceData({
	activeOrgId,
	activeThreadId,
	onDeletedActiveThread,
	selectedExistingThreadId,
}: {
	activeOrgId: string | undefined;
	activeThreadId: string | null;
	onDeletedActiveThread: () => void;
	selectedExistingThreadId: string | null;
}) {
	const queryClient = useQueryClient();
	const orgScope = activeOrgId ?? "none";

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
					{ query: { limit: "20", page: "0" } },
					orgHeadersInit(activeOrgId)
				)
			),
		queryKey: ["ai", "threads", orgScope],
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
		threadDetailQuery,
		threadsQuery,
	};
}

export function AiWorkspaceClient() {
	const {
		activeOrg,
		activeOrgId,
		currentUserRole,
		hasPermission,
		isLoading: orgLoading,
		isPermissionsPending,
	} = useCurrentOrganization();

	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
	const [selectedExistingThreadId, setSelectedExistingThreadId] = useState<
		string | null
	>(null);
	const previousOrgIdRef = useRef<string | undefined>(activeOrgId);

	useEffect(() => {
		if (activeThreadId === null || previousOrgIdRef.current !== activeOrgId) {
			previousOrgIdRef.current = activeOrgId;
			setSelectedExistingThreadId(null);
			setActiveThreadId(createThreadId());
		}
	}, [activeOrgId, activeThreadId]);

	const handleNewConversation = () => {
		setSelectedExistingThreadId(null);
		setActiveThreadId(createThreadId());
	};

	const handleSelectThread = (threadId: string) => {
		setSelectedExistingThreadId(threadId);
		setActiveThreadId(threadId);
	};

	const {
		agentsQuery,
		deleteThreadMutation,
		invalidateConversation,
		invalidateThreadsList,
		threadDetailQuery,
		threadsQuery,
	} = useAiWorkspaceData({
		activeOrgId,
		activeThreadId,
		onDeletedActiveThread: handleNewConversation,
		selectedExistingThreadId,
	});

	const isRoleResolved =
		!(orgLoading || isPermissionsPending) && currentUserRole !== null;
	const canExecuteAi = hasPermission("ai:execute");
	const agentStatus = resolveAgentStatus({
		data: agentsQuery.data,
		isError: agentsQuery.isError,
		isPending: agentsQuery.isPending,
	});
	const loadedMessages =
		selectedExistingThreadId && threadDetailQuery.data
			? (threadDetailQuery.data.messages as unknown as UIMessage[])
			: [];

	const sessionKey = `${activeOrgId ?? "none"}:${activeThreadId ?? "initializing"}`;

	const renderMainChatPane = () => {
		if (!activeThreadId) {
			return <ThreadLoadingCard />;
		}
		if (selectedExistingThreadId && threadDetailQuery.isPending) {
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
				isRoleResolved={isRoleResolved}
				isStatusPending={agentsQuery.isPending}
				key={sessionKey}
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
				modelLabel={agentStatus.modelLabel}
				onNewConversation={handleNewConversation}
				semanticRecall={agentStatus.semanticRecall}
			/>

			{/* Main 2-column Workspace */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
				<div className="order-2 flex flex-col gap-4 lg:order-1">
					<ThreadHistorySidebar
						activeThreadId={activeThreadId}
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
						isError={threadsQuery.isError}
						isPending={threadsQuery.isPending}
						onDeleteThread={(threadIdToDelete) =>
							deleteThreadMutation.mutate(threadIdToDelete)
						}
						onSelectThread={handleSelectThread}
						threads={threadsQuery.data?.threads ?? []}
					/>
					<WorkspaceBriefCard
						activeOrgId={activeOrgId}
						canExecuteAi={!isRoleResolved || canExecuteAi}
						isConfigured={agentStatus.isConfigured}
						key={activeOrgId ?? "none"}
					/>
				</div>

				<div className="order-1 min-w-0 lg:order-2">{renderMainChatPane()}</div>
			</div>
		</div>
	);
}
