import { createTool } from "@mastra/core/tools";
import type { PgVector } from "@mastra/pg";
import { z } from "zod";
import {
	DEFAULT_EMBEDDING_DIMENSIONS,
	DEFAULT_EMBEDDING_MODEL,
	tenantAiContextSchema,
	workspaceKnowledgeChunkSchema,
} from "../../contracts";
import {
	type EmbedKnowledgeFn,
	searchWorkspaceKnowledge,
} from "../rag/knowledge-index";
import { requireTenantMembership } from "./tenant-auth";

const workspaceKnowledgeInputSchema = z.object({
	limit: z.number().int().min(1).max(10).optional().default(5),
	query: z
		.string()
		.trim()
		.min(2)
		.max(400)
		.describe(
			"Semantic question or topic to search across indexed workspace files."
		),
});

const workspaceKnowledgeOutputSchema = z.object({
	chunks: z.array(workspaceKnowledgeChunkSchema),
	organizationId: z.string(),
	returnedCount: z.number().int().nonnegative(),
});

export interface WorkspaceKnowledgeToolOptions {
	embeddingDimension?: number;
	embeddingModel?: string;
	embedFn?: EmbedKnowledgeFn;
	getVector?: () => PgVector | undefined;
}

export function createWorkspaceKnowledgeTool(
	options: WorkspaceKnowledgeToolOptions = {}
) {
	return createTool({
		description:
			"Semantic search over indexed workspace documents and knowledge files in the active organization.",
		id: "search-workspace-knowledge",
		inputSchema: workspaceKnowledgeInputSchema,
		outputSchema: workspaceKnowledgeOutputSchema,
		requestContextSchema: tenantAiContextSchema,
		execute: async (inputData, context) => {
			const { organizationId } = await requireTenantMembership(
				context?.requestContext,
				{ requireStorageAction: "search workspace knowledge" }
			);

			const vector = options.getVector?.();
			if (!vector) {
				return {
					chunks: [],
					organizationId,
					returnedCount: 0,
				};
			}

			const chunks = await searchWorkspaceKnowledge({
				embedFn: options.embedFn,
				embeddingDimension:
					options.embeddingDimension ?? DEFAULT_EMBEDDING_DIMENSIONS,
				embeddingModel: options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
				limit: inputData.limit ?? 5,
				organizationId,
				query: inputData.query,
				vector,
			});

			return {
				chunks,
				organizationId,
				returnedCount: chunks.length,
			};
		},
	});
}

export const workspaceKnowledgeTool = createWorkspaceKnowledgeTool();
