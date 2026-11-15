import { z } from "zod";

export const DEFAULT_AI_AGENT_ID = "workspace-assistant";
export const DEFAULT_CHAT_MODEL = "google/gemini-2.5-flash";
export const DEFAULT_EMBEDDING_MODEL = "google/gemini-embedding-001";
export const DEFAULT_EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_MASTRA_DB_SCHEMA = "mastra";

/**
 * Chat/embedding providers supported out of the box. Model IDs use Mastra's
 * `provider/model` router format; Mastra reads the API key from the listed
 * environment variables (first match wins).
 */
export const AI_PROVIDERS = {
	anthropic: {
		apiKeyEnvVars: ["ANTHROPIC_API_KEY"],
		exampleChatModel: "anthropic/claude-sonnet-4-5",
		label: "Anthropic",
		supportsEmbeddings: false,
	},
	google: {
		apiKeyEnvVars: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
		exampleChatModel: "google/gemini-2.5-flash",
		label: "Google Gemini",
		supportsEmbeddings: true,
	},
	openai: {
		apiKeyEnvVars: ["OPENAI_API_KEY"],
		exampleChatModel: "openai/gpt-5-mini",
		label: "OpenAI",
		supportsEmbeddings: true,
	},
	openrouter: {
		apiKeyEnvVars: ["OPENROUTER_API_KEY"],
		exampleChatModel: "openrouter/anthropic/claude-sonnet-4.5",
		label: "OpenRouter",
		supportsEmbeddings: false,
	},
} as const satisfies Record<
	string,
	{
		apiKeyEnvVars: readonly string[];
		exampleChatModel: string;
		label: string;
		supportsEmbeddings: boolean;
	}
>;

export type AiProviderId = keyof typeof AI_PROVIDERS;

export interface AiProviderInfo {
	apiKeyEnvVars: string[];
	id: string;
	label: string;
	supported: boolean;
}

function isAiProviderId(value: string): value is AiProviderId {
	return Object.hasOwn(AI_PROVIDERS, value);
}

/** Returns the provider segment of a `provider/model` ID (lowercased). */
export function getModelProviderId(modelId: string): string {
	const [provider = ""] = modelId.trim().split("/");
	return provider.toLowerCase();
}

/** Describes the provider behind a model ID, including its API key env vars. */
export function getAiProviderInfo(modelId: string): AiProviderInfo {
	const id = getModelProviderId(modelId);
	if (isAiProviderId(id)) {
		const provider = AI_PROVIDERS[id];
		return {
			apiKeyEnvVars: [...provider.apiKeyEnvVars],
			id,
			label: provider.label,
			supported: true,
		};
	}
	return { apiKeyEnvVars: [], id, label: id || "unknown", supported: false };
}

/**
 * Returns whether an API key is present for the model's provider.
 * Unknown providers return `true` so Mastra can resolve credentials itself.
 */
export function hasAiProviderApiKey(
	modelId: string,
	envValues: Record<string, string | undefined>
): boolean {
	const info = getAiProviderInfo(modelId);
	if (!info.supported) {
		return true;
	}
	return info.apiKeyEnvVars.some((name) => Boolean(envValues[name]?.trim()));
}

/** Whether the embedding model belongs to a provider with embedding support. */
export function isSupportedEmbeddingModel(modelId: string): boolean {
	const id = getModelProviderId(modelId);
	return isAiProviderId(id) && AI_PROVIDERS[id].supportsEmbeddings;
}

/**
 * Provider-specific options that pin embedding output size so vectors fit
 * the pgvector index (max 2000 dimensions for HNSW).
 */
export function buildEmbeddingProviderOptions(
	modelId: string,
	dimensions: number
): Record<string, Record<string, number>> {
	const id = getModelProviderId(modelId);
	if (id === "google") {
		return { google: { outputDimensionality: dimensions } };
	}
	if (id === "openai") {
		return { openai: { dimensions } };
	}
	return {};
}

export const AI_CONTEXT_KEYS = {
	canReadMemberEmails: "canReadMemberEmails",
	canReadStorage: "canReadStorage",
	organizationId: "organizationId",
	requestId: "requestId",
	userId: "userId",
	userRole: "userRole",
} as const;

export const tenantAiContextSchema = z.object({
	canReadMemberEmails: z.boolean().optional(),
	canReadStorage: z.boolean().optional(),
	organizationId: z.string().min(1),
	requestId: z.string().min(1).optional(),
	userId: z.string().min(1),
	userRole: z.string().min(1),
});

export type TenantAiContext = z.infer<typeof tenantAiContextSchema>;

/**
 * Formats an organization- and user-scoped resource identifier for Mastra memory.
 *
 * Combining `organizationId` and `userId` prevents semantic recall or thread lookups
 * from crossing tenant boundaries when the same user belongs to multiple workspaces.
 */
export function formatTenantMemoryResourceId(
	organizationId: string,
	userId: string
): string {
	const org = organizationId.trim();
	const user = userId.trim();
	if (!(org && user)) {
		throw new Error(
			"Both organizationId and userId are required to build a tenant resourceId"
		);
	}
	return `${org}:${user}`;
}

export const aiAgentSummarySchema = z.object({
	description: z.string(),
	id: z.string(),
	model: z.string(),
	name: z.string(),
});

export type AiAgentSummary = z.infer<typeof aiAgentSummarySchema>;

export const aiAgentsResponseSchema = z.object({
	agents: z.array(aiAgentSummarySchema),
	configured: z.boolean(),
	defaultAgentId: z.string(),
	model: z.string(),
	provider: z.object({
		apiKeyEnvVars: z.array(z.string()),
		id: z.string(),
		label: z.string(),
		supported: z.boolean(),
	}),
	semanticRecall: z.boolean(),
});

export type AiAgentsResponse = z.infer<typeof aiAgentsResponseSchema>;

export const aiUserTextPartSchema = z
	.object({
		state: z.enum(["done", "streaming"]).optional(),
		text: z.string().trim().min(1).max(32_000),
		type: z.literal("text"),
	})
	.strict();

export const aiChatUserMessageSchema = z
	.object({
		id: z.string().trim().min(1).max(128).optional(),
		parts: z.array(aiUserTextPartSchema).min(1).max(32),
		role: z.literal("user"),
	})
	.strict();

export type AiChatUserMessage = z.infer<typeof aiChatUserMessageSchema>;

export const aiChatRequestSchema = z.object({
	agentId: z.string().trim().min(1).max(128).optional(),
	id: z.string().trim().min(1).max(128).optional(),
	messageId: z.string().trim().min(1).max(128).optional(),
	messages: z.array(aiChatUserMessageSchema).min(1).max(1),
	trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
});

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export const aiThreadSummarySchema = z.object({
	createdAt: z.string(),
	id: z.string(),
	title: z.string().nullable(),
	updatedAt: z.string(),
});

export type AiThreadSummary = z.infer<typeof aiThreadSummarySchema>;

export const aiThreadsResponseSchema = z.object({
	hasMore: z.boolean(),
	threads: z.array(aiThreadSummarySchema),
	total: z.number().int().nonnegative(),
});

export type AiThreadsResponse = z.infer<typeof aiThreadsResponseSchema>;

export const aiThreadDetailResponseSchema = z.object({
	messages: z.array(z.record(z.string(), z.unknown())),
	thread: aiThreadSummarySchema,
});

export type AiThreadDetailResponse = z.infer<
	typeof aiThreadDetailResponseSchema
>;

export const workspaceWorkingMemorySchema = z.object({
	activeGoals: z
		.array(z.string())
		.optional()
		.describe("Current workspace tasks or objectives the user is working on."),
	communicationPreference: z
		.string()
		.optional()
		.describe("Preferred tone, verbosity, or formatting style."),
	notes: z
		.string()
		.optional()
		.describe("Persistent workspace notes remembered across conversations."),
});

export type WorkspaceWorkingMemory = z.infer<
	typeof workspaceWorkingMemorySchema
>;

export const workspaceBriefRequestSchema = z.object({
	focus: z.string().trim().min(1).max(300).optional(),
});

export type WorkspaceBriefRequest = z.infer<typeof workspaceBriefRequestSchema>;

export const workspaceBriefMetricsSchema = z.object({
	committedUploadCount: z.number().int().nonnegative(),
	memberCount: z.number().int().nonnegative(),
	organizationId: z.string(),
	organizationName: z.string(),
	organizationSlug: z.string().nullable(),
	recentFileNames: z.array(z.string()),
	roleBreakdown: z.record(z.string(), z.number().int().nonnegative()),
	storageCurrentUsageBytes: z.number().int().nonnegative(),
	storageLimitBytes: z.number().int().nonnegative(),
	userRole: z.string(),
});

export type WorkspaceBriefMetrics = z.infer<typeof workspaceBriefMetricsSchema>;

export const workspaceBriefResponseSchema = z.object({
	generatedAt: z.string(),
	metrics: workspaceBriefMetricsSchema,
	summary: z.string(),
});

export type WorkspaceBriefResponse = z.infer<
	typeof workspaceBriefResponseSchema
>;
