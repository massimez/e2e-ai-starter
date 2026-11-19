import type { MemoryConfig } from "@mastra/core/memory";
import { workspaceWorkingMemorySchema } from "../../contracts";

export interface WorkspaceMemoryOptions {
	enableSemanticRecall: boolean;
}

/**
 * Builds the Mastra `Memory` options with token-bounded message history,
 * resource-scoped structured working memory, and optional pgvector semantic recall.
 */
export function createWorkspaceMemoryOptions({
	enableSemanticRecall,
}: WorkspaceMemoryOptions): MemoryConfig {
	return {
		generateTitle: {
			emitEvent: true,
		},
		messageHistory: {
			maxTokens: 8000,
		},
		semanticRecall: enableSemanticRecall
			? {
					indexConfig: {
						metric: "cosine",
						type: "hnsw",
					},
					messageRange: 2,
					scope: "resource",
					topK: 5,
				}
			: false,
		workingMemory: {
			enabled: true,
			schema: workspaceWorkingMemorySchema,
			scope: "resource",
		},
	};
}
