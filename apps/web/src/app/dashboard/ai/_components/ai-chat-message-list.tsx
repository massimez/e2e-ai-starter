"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { ChevronRight, Wrench } from "lucide-react";
import { renderSafeMarkdown } from "./markdown-renderer";

const TOOL_LABELS: Record<string, string> = {
	"get-workspace-context": "Workspace context",
	"list-workspace-members": "Team members",
	"search-workspace-files": "Workspace files",
	"search-workspace-knowledge": "Knowledge RAG",
	workspaceContextTool: "Workspace context",
	workspaceFilesTool: "Workspace files",
	workspaceKnowledgeTool: "Knowledge RAG",
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

export function formatToolLabel(rawName: string): string {
	return (
		TOOL_LABELS[rawName] ??
		rawName
			.split(TOOL_SPLIT_PATTERN)
			.filter(Boolean)
			.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
			.join(" ")
	);
}

export function formatToolState(state: string): string {
	return TOOL_STATE_LABELS[state] ?? state;
}

function formatJsonPreview(value: unknown): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === "string") {
		return value.trim() || null;
	}
	try {
		const formatted = JSON.stringify(value, null, 2);
		return formatted === "{}" ? null : formatted;
	} catch {
		return String(value);
	}
}

export function buildKeyedMessageParts(message: UIMessage) {
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

function resolveToolOutputPreview(
	part: UIMessage["parts"][number]
): string | null {
	if ("output" in part) {
		return formatJsonPreview(part.output);
	}
	if ("errorText" in part) {
		return formatJsonPreview(part.errorText);
	}
	return null;
}

export function ChatMessagePart({
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
		return renderSafeMarkdown(part.text, partKey, {
			isAnimating: part.state === "streaming",
		});
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
		const inputPreview = "input" in part ? formatJsonPreview(part.input) : null;
		const outputPreview = resolveToolOutputPreview(part);
		const hasDetails = Boolean(inputPreview || outputPreview);

		if (!hasDetails) {
			return (
				<div className="bg-background/70 border-border/60 my-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]">
					<Wrench
						aria-hidden="true"
						className="text-primary h-3 w-3 shrink-0"
					/>
					<span className="font-medium">{formatToolLabel(toolName)}</span>
					<span className="text-muted-foreground">
						{formatToolState(part.state)}
					</span>
				</div>
			);
		}

		return (
			<details className="bg-background/70 border-border/60 group my-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]">
				<summary className="flex cursor-pointer list-none items-center justify-between gap-2 select-none">
					<span className="inline-flex items-center gap-1.5">
						<ChevronRight
							aria-hidden="true"
							className="text-muted-foreground h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
						/>
						<Wrench
							aria-hidden="true"
							className="text-primary h-3 w-3 shrink-0"
						/>
						<span className="font-medium">{formatToolLabel(toolName)}</span>
					</span>
					<span className="text-muted-foreground">
						{formatToolState(part.state)}
					</span>
				</summary>
				<div className="border-border/50 mt-2 space-y-1.5 border-t pt-2">
					{inputPreview ? (
						<div>
							<div className="text-muted-foreground text-[10px] font-medium">
								Input
							</div>
							<pre className="bg-muted/50 mt-0.5 max-h-32 overflow-auto rounded p-1.5 font-mono text-[10px]">
								{inputPreview}
							</pre>
						</div>
					) : null}
					{outputPreview ? (
						<div>
							<div className="text-muted-foreground text-[10px] font-medium">
								Output
							</div>
							<pre className="bg-muted/50 mt-0.5 max-h-40 overflow-auto rounded p-1.5 font-mono text-[10px]">
								{outputPreview}
							</pre>
						</div>
					) : null}
				</div>
			</details>
		);
	}
	return null;
}
