import {
	type InputProcessorOrWorkflow,
	type OutputProcessorOrWorkflow,
	RegexFilterProcessor,
	TokenLimiterProcessor,
	UnicodeNormalizer,
} from "@mastra/core/processors";

const DEFAULT_MAX_INPUT_TOKENS = 16_000;

/**
 * Deterministic input guardrail processors:
 * 1. Normalizes Unicode and strips control characters.
 * 2. Caps input context tokens to prevent context-window overflow.
 */
export function createInputGuardrailProcessors(
	maxTokens = DEFAULT_MAX_INPUT_TOKENS
): InputProcessorOrWorkflow[] {
	return [
		new UnicodeNormalizer({
			collapseWhitespace: false,
			preserveEmojis: true,
			stripControlChars: true,
			trim: true,
		}),
		new TokenLimiterProcessor({
			limit: maxTokens,
			strategy: "truncate",
		}),
	];
}

/**
 * Deterministic output guardrail processors:
 * Redacts accidentally echoed API keys, bearer tokens, or secret formats in both
 * streamed chunks and final responses with zero extra LLM calls.
 */
export function createOutputGuardrailProcessors(): OutputProcessorOrWorkflow[] {
	return [
		new RegexFilterProcessor({
			phase: "output",
			presets: ["secrets"],
			strategy: "redact",
		}),
	];
}
