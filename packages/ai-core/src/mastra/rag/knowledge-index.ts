import { ModelRouterEmbeddingModel } from "@mastra/core/llm";
import type { PgVector } from "@mastra/pg";
import {
	buildEmbeddingProviderOptions,
	DEFAULT_EMBEDDING_DIMENSIONS,
	DEFAULT_EMBEDDING_MODEL,
	type WorkspaceKnowledgeChunk,
} from "../../contracts";

export const WORKSPACE_KNOWLEDGE_INDEX = "workspace_knowledge";
const MAX_CHUNKS_PER_UPLOAD = 48;
const DEFAULT_CHUNK_MAX_CHARS = 800;
const DEFAULT_CHUNK_OVERLAP_CHARS = 120;

export type EmbedKnowledgeFn = (params: {
	embeddingDimension: number;
	embeddingModel: string;
	values: string[];
}) => Promise<number[][]>;

/**
 * Splits plain text into bounded overlapping chunks for pgvector RAG indexing,
 * preferring paragraph or newline breaks when available.
 */
export function chunkKnowledgeText(
	rawText: string,
	maxChunkChars = DEFAULT_CHUNK_MAX_CHARS,
	overlapChars = DEFAULT_CHUNK_OVERLAP_CHARS
): string[] {
	const normalized = rawText.replace(/\r\n/gu, "\n").trim();
	if (!normalized) {
		return [];
	}

	const safeMax = Math.max(1, maxChunkChars);
	const safeOverlap = Math.max(0, Math.min(overlapChars, safeMax - 1));
	const chunks: string[] = [];
	let start = 0;

	while (start < normalized.length && chunks.length < MAX_CHUNKS_PER_UPLOAD) {
		let end = Math.min(normalized.length, start + safeMax);
		if (end < normalized.length) {
			const windowText = normalized.slice(start, end);
			const breakOffset = Math.max(
				windowText.lastIndexOf("\n\n"),
				windowText.lastIndexOf("\n")
			);
			if (breakOffset > safeMax * 0.4) {
				end = start + breakOffset;
			}
		}

		const chunk = normalized.slice(start, end).trim();
		if (chunk) {
			chunks.push(chunk);
		}
		if (end >= normalized.length) {
			break;
		}
		start = Math.max(start + 1, end - safeOverlap);
	}

	return chunks;
}

const initializedVectorIndexes = new WeakSet<PgVector>();

function isMissingVectorIndexError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const { code, message } = error as { code?: unknown; message?: unknown };
	if (code === "42P01") {
		return true;
	}
	return (
		typeof message === "string" &&
		(message.includes("does not exist") || message.includes("no such table"))
	);
}

async function ensureKnowledgeIndex(
	vector: PgVector,
	embeddingDimension: number
): Promise<void> {
	if (initializedVectorIndexes.has(vector)) {
		return;
	}
	await vector.createIndex({
		dimension: embeddingDimension,
		indexName: WORKSPACE_KNOWLEDGE_INDEX,
		metric: "cosine",
	});
	initializedVectorIndexes.add(vector);
}

export async function defaultEmbedKnowledgeValues(params: {
	embeddingDimension: number;
	embeddingModel: string;
	values: string[];
}): Promise<number[][]> {
	const model = new ModelRouterEmbeddingModel(params.embeddingModel);
	const result = await model.doEmbed({
		providerOptions: buildEmbeddingProviderOptions(
			params.embeddingModel,
			params.embeddingDimension
		),
		values: params.values,
	});
	return result.embeddings;
}

export async function indexWorkspaceUploadKnowledge(params: {
	content: string;
	embedFn?: EmbedKnowledgeFn;
	embeddingDimension?: number;
	embeddingModel?: string;
	fileName: string;
	organizationId: string;
	uploadId: string;
	vector: PgVector;
}): Promise<{ chunkCount: number }> {
	const organizationId = params.organizationId.trim();
	const uploadId = params.uploadId.trim();
	if (!(organizationId && uploadId)) {
		throw new Error(
			"organizationId and uploadId are required for RAG indexing"
		);
	}

	const chunks = chunkKnowledgeText(params.content);
	if (chunks.length === 0) {
		return { chunkCount: 0 };
	}

	const embeddingModel = params.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
	const embeddingDimension =
		params.embeddingDimension ?? DEFAULT_EMBEDDING_DIMENSIONS;
	const embedFn = params.embedFn ?? defaultEmbedKnowledgeValues;

	await ensureKnowledgeIndex(params.vector, embeddingDimension);

	const vectors = await embedFn({
		embeddingDimension,
		embeddingModel,
		values: chunks,
	});

	const ids = chunks.map(
		(_, index) => `${organizationId}:${uploadId}:${index}`
	);
	const metadata = chunks.map((text, chunkIndex) => ({
		chunkIndex,
		fileName: params.fileName,
		organizationId,
		text,
		uploadId,
	}));

	await params.vector.upsert({
		deleteFilter: {
			organizationId,
			uploadId,
		},
		ids,
		indexName: WORKSPACE_KNOWLEDGE_INDEX,
		metadata,
		vectors,
	});

	return { chunkCount: chunks.length };
}

export async function searchWorkspaceKnowledge(params: {
	embedFn?: EmbedKnowledgeFn;
	embeddingDimension?: number;
	embeddingModel?: string;
	limit?: number;
	organizationId: string;
	query: string;
	vector: PgVector;
}): Promise<WorkspaceKnowledgeChunk[]> {
	const organizationId = params.organizationId.trim();
	const query = params.query.trim();
	if (!(organizationId && query)) {
		return [];
	}

	const embeddingModel = params.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
	const embeddingDimension =
		params.embeddingDimension ?? DEFAULT_EMBEDDING_DIMENSIONS;
	const embedFn = params.embedFn ?? defaultEmbedKnowledgeValues;

	const [queryVector] = await embedFn({
		embeddingDimension,
		embeddingModel,
		values: [query],
	});
	if (!queryVector) {
		return [];
	}

	try {
		const matches = await params.vector.query({
			filter: { organizationId },
			indexName: WORKSPACE_KNOWLEDGE_INDEX,
			minScore: 0.2,
			queryVector,
			topK: Math.min(20, Math.max(1, params.limit ?? 5)),
		});

		return matches.flatMap((match) => {
			const meta = match.metadata ?? {};
			if (meta.organizationId !== organizationId) {
				return [];
			}
			const text = typeof meta.text === "string" ? meta.text : "";
			if (!text) {
				return [];
			}
			return [
				{
					chunkIndex: typeof meta.chunkIndex === "number" ? meta.chunkIndex : 0,
					fileName:
						typeof meta.fileName === "string" ? meta.fileName : "document",
					score: Number(match.score.toFixed(4)),
					text,
					uploadId:
						typeof meta.uploadId === "string" ? meta.uploadId : match.id,
				},
			];
		});
	} catch (error) {
		if (isMissingVectorIndexError(error)) {
			return [];
		}
		throw error;
	}
}

export async function deleteWorkspaceKnowledgeForUpload(params: {
	organizationId: string;
	uploadId?: string;
	vector: PgVector | undefined;
}): Promise<void> {
	if (!params.vector) {
		return;
	}
	try {
		await params.vector.deleteVectors({
			filter: {
				organizationId: params.organizationId,
				...(params.uploadId ? { uploadId: params.uploadId } : {}),
			},
			indexName: WORKSPACE_KNOWLEDGE_INDEX,
		});
	} catch (error) {
		if (isMissingVectorIndexError(error)) {
			return;
		}
		throw error;
	}
}
