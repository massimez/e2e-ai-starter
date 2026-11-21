"use client";

import { useChat } from "@ai-sdk/react";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@workspace/ui/components/card";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
	AlertCircle,
	Bot,
	Loader2,
	Send,
	Sparkles,
	Square,
} from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	buildKeyedMessageParts,
	ChatMessagePart,
} from "./ai-chat-message-list";

const STARTER_PROMPTS = [
	"Summarize my active workspace, role, and storage quota usage.",
	"List the members and roles in this workspace.",
	"Search committed files and indexed knowledge in our workspace.",
] as const;

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

export interface AiChatSessionPaneProps {
	activeOrgId?: string;
	activeOrgName: string | null;
	agentId: string;
	apiKeyEnvVars: string[];
	canExecuteAi: boolean;
	initialMessages: UIMessage[];
	isConfigured: boolean;
	isRoleResolved: boolean;
	isStatusPending: boolean;
	modelId?: string;
	onConversationFinished: () => void;
	onThreadTitleGenerated: () => void;
	providerLabel: string;
	statusError: string | null;
	threadDetailUpdatedAt: number;
	threadId: string | null;
}

export function AiChatSessionPane({
	activeOrgId,
	activeOrgName,
	agentId,
	apiKeyEnvVars,
	canExecuteAi,
	initialMessages,
	isConfigured,
	isRoleResolved,
	isStatusPending,
	modelId,
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
				body: {
					agentId,
					...(modelId ? { modelId } : {}),
				},
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
		[activeOrgId, agentId, modelId]
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
				setLiveAnnouncement(
					isAbort
						? "Assistant response stopped."
						: "Assistant response complete."
				);
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
		if ((messages.length === 0 && !isStreaming) || !isNearBottomRef.current) {
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
									search saved files, RAG documents, members, and earlier
									messages.
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
								placeholder="Ask about workspace quota, members, or indexed files..."
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
