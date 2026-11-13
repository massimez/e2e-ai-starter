"use client";

import { useChat } from "@ai-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	AiAgentsResponse,
	AiThreadDetailResponse,
	AiThreadsResponse,
	WorkspaceBriefResponse,
} from "@workspace/ai-core/contracts";
import {
	type OrganizationRoleName,
	parseMemberRoles,
	roleAllows,
	roles,
} from "@workspace/api/permissions";
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
	Send,
	Sparkles,
	Square,
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
import { useCurrentOrganization } from "@/lib/organization-hooks";

const STARTER_PROMPTS = [
	"Summarize my active workspace, role, and storage quota usage.",
	"List the members and roles in this workspace.",
	"Search committed files in our workspace storage.",
] as const;

function createThreadId(): string {
	return crypto.randomUUID();
}

function getUserCanExecuteAi(roleValue: string | null): boolean {
	if (!roleValue) {
		return false;
	}
	const parsed = parseMemberRoles(roleValue);
	return parsed
		.filter((role): role is OrganizationRoleName => role in roles)
		.some((role) => roleAllows(role, "ai", "execute"));
}

interface AiChatSessionPaneProps {
	activeOrgName: string | null;
	agentId: string;
	apiKeyEnvVars: string[];
	canExecuteAi: boolean;
	initialMessages: UIMessage[];
	isConfigured: boolean;
	isRoleResolved: boolean;
	onConversationFinished: () => void;
	providerLabel: string;
	threadId: string;
}

function AiChatSessionPane({
	activeOrgName,
	agentId,
	apiKeyEnvVars,
	canExecuteAi,
	initialMessages,
	isConfigured,
	isRoleResolved,
	onConversationFinished,
	providerLabel,
	threadId,
}: AiChatSessionPaneProps) {
	const [input, setInput] = useState("");
	const [liveAnnouncement, setLiveAnnouncement] = useState("");
	const scrollBottomRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	const transport = useMemo(
		() =>
			new DefaultChatTransport<UIMessage>({
				api: "/api/ai/chat",
				body: { agentId },
				credentials: "include",
			}),
		[agentId]
	);

	const { error, messages, sendMessage, status, stop } = useChat<UIMessage>({
		id: threadId,
		messages: initialMessages,
		onError: (err) => {
			setLiveAnnouncement(`Assistant request failed: ${err.message}`);
		},
		onFinish: () => {
			setLiveAnnouncement("Assistant response complete.");
			onConversationFinished();
		},
		transport,
	});

	const isStreaming = status === "submitted" || status === "streaming";
	const canSubmit =
		!isStreaming &&
		isConfigured &&
		(!isRoleResolved || canExecuteAi) &&
		input.trim().length > 0;

	useEffect(() => {
		if (messages.length === 0 && !isStreaming) {
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
			behavior: prefersReduced ? "auto" : "smooth",
			block: "end",
		});
	}, [messages.length, isStreaming]);

	const handleSubmitPrompt = async () => {
		const trimmed = input.trim();
		if (!trimmed || isStreaming) {
			return;
		}
		setInput("");
		setLiveAnnouncement("Assistant responding.");
		await sendMessage({ text: trimmed });
	};

	const handleFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		await handleSubmitPrompt();
	};

	const handleTextareaKeyDown = async (
		event: KeyboardEvent<HTMLTextAreaElement>
	) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			if (canSubmit) {
				await handleSubmitPrompt();
			}
		}
	};

	return (
		<Card className="border-border/60 bg-card/80 flex min-h-[34rem] flex-col gap-0 overflow-hidden py-0 shadow-xs backdrop-blur-xs">
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

			<CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-0">
				<div aria-live="polite" className="sr-only">
					{liveAnnouncement}
				</div>

				{isConfigured ? null : (
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
									<code className="font-mono">
										{apiKeyEnvVars.join(" or ")}
									</code>
								) : (
									"the provider API key"
								)}{" "}
								in your root <code className="font-mono">.env</code> file (or
								change <code className="font-mono">MASTRA_DEFAULT_MODEL</code>)
								and restart the API service to enable live chat responses.
							</p>
						</div>
					</div>
				)}

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
							<p className="break-words">{error.message}</p>
						</div>
					</div>
				) : null}

				<div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
					{messages.length === 0 ? (
						<div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-5 py-6 text-center">
							<div className="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-2xl">
								<Sparkles aria-hidden="true" className="h-6 w-6" />
							</div>
							<div className="max-w-md space-y-1.5">
								<h2 className="text-foreground text-base font-semibold">
									Ask about your active workspace
								</h2>
								<p className="text-muted-foreground text-xs leading-relaxed">
									Conversations are isolated to your active organization and
									user account using Mastra memory and pgvector semantic recall.
								</p>
							</div>
							<div className="flex max-w-xl flex-wrap items-center justify-center gap-2">
								{STARTER_PROMPTS.map((prompt) => (
									<Button
										disabled={
											!isConfigured ||
											isStreaming ||
											(isRoleResolved && !canExecuteAi)
										}
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
											{buildKeyedMessageParts(message).map(({ key, part }) => {
												if (part.type === "text") {
													return (
														<p
															className="break-words whitespace-pre-wrap"
															key={key}
														>
															{part.text}
														</p>
													);
												}
												if (isToolUIPart(part)) {
													const toolName = getToolName(part);
													return (
														<div
															className="bg-background/70 border-border/60 my-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]"
															key={key}
														>
															<Wrench
																aria-hidden="true"
																className="text-primary h-3 w-3"
															/>
															<span>{toolName}</span>
															<span className="text-muted-foreground">
																({part.state})
															</span>
														</div>
													);
												}
												return null;
											})}
										</div>
									</li>
								);
							})}
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
								disabled={!isConfigured || (isRoleResolved && !canExecuteAi)}
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
	activeThreadId: string;
	isError: boolean;
	isPending: boolean;
	onSelectThread: (threadId: string) => void;
	threads: AiThreadsResponse["threads"];
}

function ThreadHistorySidebar({
	activeThreadId,
	isError,
	isPending,
	onSelectThread,
	threads,
}: ThreadHistorySidebarProps) {
	let body = (
		<ul className="space-y-1">
			{threads.map((thread) => {
				const isSelected = activeThreadId === thread.id;
				return (
					<li key={thread.id}>
						<button
							aria-current={isSelected ? "true" : undefined}
							className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${
								isSelected
									? "bg-primary/10 text-primary font-medium"
									: "text-foreground hover:bg-muted/60"
							}`}
							onClick={() => onSelectThread(thread.id)}
							type="button"
						>
							<div className="truncate">
								{thread.title?.trim() || "Untitled conversation"}
							</div>
							<div className="text-muted-foreground mt-0.5 text-[10px]">
								{new Date(thread.updatedAt).toLocaleDateString()}
							</div>
						</button>
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
				<CardContent className="p-2">{body}</CardContent>
			</Card>
		</aside>
	);
}

interface WorkspaceBriefCardProps {
	canExecuteAi: boolean;
	isConfigured: boolean;
}

function WorkspaceBriefCard({
	canExecuteAi,
	isConfigured,
}: WorkspaceBriefCardProps) {
	const briefMutation = useMutation<WorkspaceBriefResponse, Error>({
		mutationFn: async () =>
			parseApiResponse<WorkspaceBriefResponse>(
				await client.api.ai.workflows["workspace-brief"].$post({
					json: {},
				})
			),
	});

	return (
		<Card className="border-border/60 bg-card/70 gap-0 py-0 shadow-xs backdrop-blur-xs">
			<CardHeader className="border-border/60 flex flex-row items-center justify-between border-b px-4 py-3">
				<CardTitle className="text-sm font-semibold">Brief Workflow</CardTitle>
				<Badge appearance="light" size="sm" variant="secondary">
					2-step
				</Badge>
			</CardHeader>
			<CardContent className="space-y-3 p-3.5 text-xs">
				<p className="text-muted-foreground leading-relaxed">
					Runs <code className="font-mono">workspace-brief</code>: gathers
					metrics, members, and files in parallel, then synthesizes a report.
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
					{briefMutation.isPending ? "Running workflow..." : "Run Brief"}
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
						<p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
							{briefMutation.data.summary}
						</p>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function resolveAgentStatus(data: AiAgentsResponse | undefined) {
	return {
		apiKeyEnvVars: data?.provider.apiKeyEnvVars ?? [],
		defaultAgentId: data?.defaultAgentId ?? "workspace-assistant",
		isConfigured: data?.configured ?? true,
		modelLabel: data?.model ?? "loading model...",
		providerLabel: data?.provider.label ?? "AI provider",
		semanticRecall: data?.semanticRecall ?? false,
	};
}

export function AiWorkspaceClient() {
	const queryClient = useQueryClient();
	const {
		activeOrg,
		activeOrgId,
		currentUserRole,
		isLoading: orgLoading,
	} = useCurrentOrganization();

	const [activeThreadId, setActiveThreadId] = useState<string>(() =>
		createThreadId()
	);
	const [selectedExistingThreadId, setSelectedExistingThreadId] = useState<
		string | null
	>(null);

	useEffect(() => {
		if (!activeOrgId) {
			return;
		}
		setSelectedExistingThreadId(null);
		setActiveThreadId(createThreadId());
	}, [activeOrgId]);

	const agentsQuery = useQuery<AiAgentsResponse>({
		enabled: Boolean(activeOrgId),
		queryFn: async () =>
			parseApiResponse<AiAgentsResponse>(await client.api.ai.agents.$get()),
		queryKey: ["ai", "agents", activeOrgId ?? "none"],
		staleTime: 60_000,
	});

	const threadsQuery = useQuery<AiThreadsResponse>({
		enabled: Boolean(activeOrgId),
		queryFn: async () =>
			parseApiResponse<AiThreadsResponse>(
				await client.api.ai.threads.$get({
					query: { limit: "20", page: "0" },
				})
			),
		queryKey: ["ai", "threads", activeOrgId ?? "none"],
	});

	const threadDetailQuery = useQuery<AiThreadDetailResponse>({
		enabled: Boolean(activeOrgId && selectedExistingThreadId),
		queryFn: async () => {
			if (!selectedExistingThreadId) {
				throw new Error("No thread selected");
			}
			return parseApiResponse<AiThreadDetailResponse>(
				await client.api.ai.threads[":id"].$get({
					param: { id: selectedExistingThreadId },
				})
			);
		},
		queryKey: [
			"ai",
			"thread",
			activeOrgId ?? "none",
			selectedExistingThreadId ?? "none",
		],
	});

	const handleNewConversation = () => {
		setSelectedExistingThreadId(null);
		setActiveThreadId(createThreadId());
	};

	const handleSelectThread = (threadId: string) => {
		setSelectedExistingThreadId(threadId);
		setActiveThreadId(threadId);
	};

	const isRoleResolved = !orgLoading && currentUserRole !== null;
	const canExecuteAi = getUserCanExecuteAi(currentUserRole);
	const {
		apiKeyEnvVars,
		defaultAgentId,
		isConfigured,
		modelLabel,
		providerLabel,
		semanticRecall,
	} = resolveAgentStatus(agentsQuery.data);
	const loadedMessages =
		selectedExistingThreadId && threadDetailQuery.data
			? (threadDetailQuery.data.messages as unknown as UIMessage[])
			: [];

	const sessionKey = `${activeOrgId ?? "none"}:${activeThreadId}:${
		selectedExistingThreadId && threadDetailQuery.data ? "loaded" : "fresh"
	}`;

	return (
		<div className="flex flex-col gap-6">
			{/* Page Banner */}
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
								{semanticRecall ? "pgvector Memory" : "Thread Memory"}
							</Badge>
						</div>
						<p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
							Multi-turn Mastra AI agent grounded with verified workspace tools
							and tenant-isolated conversation threads.
						</p>
					</div>

					<div className="flex shrink-0 items-center gap-2">
						<Button
							onClick={handleNewConversation}
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

			{/* Main 2-column Workspace */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
				<div className="flex flex-col gap-4">
					<ThreadHistorySidebar
						activeThreadId={activeThreadId}
						isError={threadsQuery.isError}
						isPending={threadsQuery.isPending}
						onSelectThread={handleSelectThread}
						threads={threadsQuery.data?.threads ?? []}
					/>
					<WorkspaceBriefCard
						canExecuteAi={!isRoleResolved || canExecuteAi}
						isConfigured={isConfigured}
					/>
				</div>

				<div className="min-w-0">
					{selectedExistingThreadId && threadDetailQuery.isPending ? (
						<Card className="border-border/60 bg-card/80 flex min-h-[34rem] items-center justify-center shadow-xs">
							<div className="text-muted-foreground flex items-center gap-2 text-sm">
								<Loader2
									aria-hidden="true"
									className="text-primary h-4 w-4 animate-spin"
								/>
								<span>Loading conversation...</span>
							</div>
						</Card>
					) : (
						<AiChatSessionPane
							activeOrgName={activeOrg?.name ?? null}
							agentId={defaultAgentId}
							apiKeyEnvVars={apiKeyEnvVars}
							canExecuteAi={canExecuteAi}
							initialMessages={loadedMessages}
							isConfigured={isConfigured}
							isRoleResolved={isRoleResolved}
							key={sessionKey}
							onConversationFinished={() => {
								void queryClient.invalidateQueries({
									queryKey: ["ai", "threads", activeOrgId ?? "none"],
								});
							}}
							providerLabel={providerLabel}
							threadId={activeThreadId}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
