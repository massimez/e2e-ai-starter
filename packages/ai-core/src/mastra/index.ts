import {
	DEFAULT_CHAT_MODEL,
	DEFAULT_EMBEDDING_DIMENSIONS,
	DEFAULT_EMBEDDING_MODEL,
	DEFAULT_MASTRA_DB_SCHEMA,
	hasAiProviderApiKey,
	isSupportedEmbeddingModel,
} from "../contracts";
import { createMastraRuntime } from "../runtime";

function resolveEmbeddingDimensions(rawValue: string | undefined): number {
	if (!rawValue) {
		return DEFAULT_EMBEDDING_DIMENSIONS;
	}
	const parsed = Number.parseInt(rawValue, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_EMBEDDING_DIMENSIONS;
	}
	return parsed;
}

const embeddingModel =
	process.env.MASTRA_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;

/**
 * Mastra CLI / Studio entrypoint (`bun run dev:ai`).
 */
export const { mastra } = createMastraRuntime({
	databaseUrl: process.env.DATABASE_URL,
	defaultModel: process.env.MASTRA_DEFAULT_MODEL || DEFAULT_CHAT_MODEL,
	embeddingDimensions: resolveEmbeddingDimensions(
		process.env.MASTRA_EMBEDDING_DIMENSIONS
	),
	embeddingModel,
	enableSemanticRecall:
		isSupportedEmbeddingModel(embeddingModel) &&
		hasAiProviderApiKey(embeddingModel, process.env),
	schemaName: process.env.MASTRA_DB_SCHEMA || DEFAULT_MASTRA_DB_SCHEMA,
});
