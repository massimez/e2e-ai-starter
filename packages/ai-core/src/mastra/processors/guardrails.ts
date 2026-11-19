import {
	type InputProcessorOrWorkflow,
	type OutputProcessorOrWorkflow,
	type ProcessInputStepArgs,
	type ProcessInputStepResult,
	type Processor,
	RegexFilterProcessor,
	TokenLimiterProcessor,
	UnicodeNormalizer,
} from "@mastra/core/processors";

const DEFAULT_MAX_INPUT_TOKENS = 16_000;
const DEFAULT_MAX_AGENT_STEPS = 5;

/**
 * Forces `toolChoice: "none"` on the final step of a multi-step agent loop so tool-calling
 * runs always conclude with a natural-language answer instead of an empty final step.
 */
export class EnsureFinalResponseProcessor
	implements Processor<"ensure-final-response">
{
	readonly id = "ensure-final-response";
	readonly name = "Ensure Final Response";
	private readonly finalStepIndex: number;

	constructor(maxSteps = DEFAULT_MAX_AGENT_STEPS) {
		this.finalStepIndex = Math.max(0, maxSteps - 1);
	}

	processInputStep({
		stepNumber,
	}: ProcessInputStepArgs): ProcessInputStepResult | undefined {
		if (stepNumber >= this.finalStepIndex) {
			return { toolChoice: "none" };
		}
		return undefined;
	}
}

/**
 * Deterministic input guardrail processors:
 * 1. Normalizes Unicode and strips control characters.
 * 2. Caps input context tokens contiguously to preserve conversation coherence.
 * 3. Forces final-step text synthesis when reaching maxSteps.
 */
export function createInputGuardrailProcessors(
	maxTokens = DEFAULT_MAX_INPUT_TOKENS,
	maxSteps = DEFAULT_MAX_AGENT_STEPS
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
			trimMode: "contiguous",
		}),
		new EnsureFinalResponseProcessor(maxSteps),
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
