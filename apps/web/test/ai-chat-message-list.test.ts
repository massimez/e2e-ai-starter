import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ChatMessagePart,
	getStreamingAssistantStatus,
	hasVisibleMessageContent,
} from "../src/app/dashboard/ai/_components/ai-chat-message-list";

describe("getStreamingAssistantStatus", () => {
	test("returns 'thinking' when assistant message has no visible parts yet", () => {
		const message: UIMessage = {
			id: "msg-1",
			parts: [{ type: "step-start" }],
			role: "assistant",
		};
		expect(getStreamingAssistantStatus(message)).toBe("thinking");
	});

	test("returns 'generating' after a tool call finishes and before response text streams", () => {
		const message: UIMessage = {
			id: "msg-2",
			parts: [
				{ type: "step-start" },
				{
					input: { query: "quota" },
					output: { matches: [] },
					state: "output-available",
					toolCallId: "call-1",
					type: "tool-search-workspace-knowledge",
				},
			],
			role: "assistant",
		};
		expect(getStreamingAssistantStatus(message)).toBe("generating");
	});

	test("returns 'generating' when streaming text part is still whitespace after a completed tool", () => {
		const message: UIMessage = {
			id: "msg-3",
			parts: [
				{
					input: { query: "quota" },
					output: { matches: [] },
					state: "output-available",
					toolCallId: "call-1",
					type: "tool-search-workspace-knowledge",
				},
				{
					state: "streaming",
					text: "   ",
					type: "text",
				},
			],
			role: "assistant",
		};
		expect(getStreamingAssistantStatus(message)).toBe("generating");
	});

	test("returns null when a tool is actively running", () => {
		const message: UIMessage = {
			id: "msg-4",
			parts: [
				{
					input: { query: "quota" },
					state: "input-available",
					toolCallId: "call-1",
					type: "tool-search-workspace-knowledge",
				},
			],
			role: "assistant",
		};
		expect(getStreamingAssistantStatus(message)).toBeNull();
	});

	test("returns null when assistant text is actively streaming", () => {
		const message: UIMessage = {
			id: "msg-5",
			parts: [
				{
					state: "streaming",
					text: "Here is your workspace summary",
					type: "text",
				},
			],
			role: "assistant",
		};
		expect(getStreamingAssistantStatus(message)).toBeNull();
	});
});

describe("ChatMessagePart", () => {
	test("renders spinner for running tool and static Done state for completed tool", () => {
		const runningHtml = renderToStaticMarkup(
			createElement(ChatMessagePart, {
				isUser: false,
				part: {
					input: { query: "members" },
					state: "input-available",
					toolCallId: "call-run",
					type: "tool-search-workspace-knowledge",
				},
				partKey: "part-run",
			})
		);
		expect(runningHtml).toContain("Knowledge RAG");
		expect(runningHtml).toContain("Running");
		expect(runningHtml).toContain("animate-spin");

		const doneHtml = renderToStaticMarkup(
			createElement(ChatMessagePart, {
				isUser: false,
				part: {
					input: { query: "members" },
					output: { total: 3 },
					state: "output-available",
					toolCallId: "call-done",
					type: "tool-search-workspace-knowledge",
				},
				partKey: "part-done",
			})
		);
		expect(doneHtml).toContain("Knowledge RAG");
		expect(doneHtml).toContain("Done");
		expect(doneHtml).not.toContain("animate-spin");
	});
});

describe("hasVisibleMessageContent", () => {
	test("returns false for empty or step-start-only assistant messages", () => {
		expect(
			hasVisibleMessageContent({
				id: "empty-1",
				parts: [],
				role: "assistant",
			})
		).toBe(false);
		expect(
			hasVisibleMessageContent({
				id: "empty-2",
				parts: [{ type: "step-start" }, { text: "   ", type: "text" }],
				role: "assistant",
			})
		).toBe(false);
	});

	test("returns true when message has non-empty text or tool parts", () => {
		expect(
			hasVisibleMessageContent({
				id: "msg-text",
				parts: [{ text: "Hello", type: "text" }],
				role: "assistant",
			})
		).toBe(true);
		expect(
			hasVisibleMessageContent({
				id: "msg-tool",
				parts: [
					{
						input: {},
						output: {},
						state: "output-available",
						toolCallId: "t-1",
						type: "tool-get-workspace-context",
					},
				],
				role: "assistant",
			})
		).toBe(true);
	});
});
