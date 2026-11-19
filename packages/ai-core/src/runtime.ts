import type { Agent } from "@mastra/core/agent";
import { ConsoleLogger, LogLevel, noopLogger } from "@mastra/core/logger";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import { MastraStorageExporter, Observability } from "@mastra/observability";
import { PgVector, PostgresStoreVNext } from "@mastra/pg";
import {
	AI_CONTEXT_KEYS,
	buildEmbeddingProviderOptions,
	DEFAULT_AI_AGENT_ID,
	DEFAULT_CHAT_MODEL,
	DEFAULT_EMBEDDING_DIMENSIONS,
	DEFAULT_EMBEDDING_MODEL,
	DEFAULT_MASTRA_DB_SCHEMA,
	formatTenantMemoryResourceId,
	type TenantAiContext,
	tenantAiContextSchema,
} from "./contracts";
import { createWorkspaceAssistantAgent } from "./mastra/agents/assistant-agent";
import { createWorkspaceMemoryOptions } from "./mastra/memory/working-memory";
import { workspaceContextTool } from "./mastra/tools/workspace-context-tool";
import { workspaceFilesTool } from "./mastra/tools/workspace-files-tool";
import { createWorkspaceKnowledgeTool } from "./mastra/tools/workspace-knowledge-tool";
import { workspaceMembersTool } from "./mastra/tools/workspace-members-tool";
import { workspaceBriefWorkflow } from "./mastra/workflows/workspace-brief-workflow";

export interface MastraRuntimeConfig {
	databaseSsl?: boolean;
	databaseUrl?: string;
	defaultModel?: string;
	disableStorageInit?: boolean;
	embeddingDimensions?: number;
	embeddingModel?: string;
	/** Enable pgvector semantic recall (requires an API key for the embedding provider). Defaults to true. */
	enableSemanticRecall?: boolean;
	logLevel?: "debug" | "info" | "warn" | "error";
	/** Maximum connections for the shared Mastra PostgreSQL pool. Defaults to 5. */
	maxPoolConnections?: number;
	schemaName?: string;
}

export interface MastraRuntime {
	agents: Record<string, Agent>;
	close: () => Promise<void>;
	embeddingDimension: number;
	embeddingModel: string;
	mastra: Mastra;
	memory: Memory | undefined;
	model: string;
	storage: PostgresStoreVNext | undefined;
	vector: PgVector | undefined;
}

const MASTRA_LOG_LEVELS = {
	debug: LogLevel.DEBUG,
	error: LogLevel.ERROR,
	info: LogLevel.INFO,
	warn: LogLevel.WARN,
} as const;

/**
 * Validates and builds a Mastra `RequestContext` populated with trusted tenant fields.
 */
export function createTenantRequestContext(
	input: TenantAiContext
): RequestContext<TenantAiContext> {
	const parsed = tenantAiContextSchema.parse(input);
	const requestContext = new RequestContext<TenantAiContext>();
	for (const [key, value] of Object.entries(parsed)) {
		if (value !== undefined) {
			requestContext.set(key as keyof TenantAiContext, value);
		}
	}
	if (parsed.canReadStorage === undefined) {
		requestContext.set(AI_CONTEXT_KEYS.canReadStorage, false);
	}
	return requestContext;
}

async function deleteThreadsForResource(
	memory: Memory,
	resourceId: string
): Promise<number> {
	const page = await memory.listThreads({
		filter: { resourceId },
		page: 0,
		perPage: 100,
	});
	if (page.threads.length === 0) {
		return 0;
	}
	await Promise.all(
		page.threads.map((thread) => memory.deleteThread(thread.id))
	);
	const remaining = page.hasMore
		? await deleteThreadsForResource(memory, resourceId)
		: 0;
	return page.threads.length + remaining;
}

/**
 * Deletes persisted Mastra threads owned by the specified `(organizationId, userId)` pairs.
 */
export async function deleteTenantMemoryData(params: {
	organizationId: string;
	runtime: MastraRuntime;
	userIds: readonly string[];
}): Promise<number> {
	const { organizationId, runtime, userIds } = params;
	if (!runtime.memory || userIds.length === 0) {
		return 0;
	}
	const { memory } = runtime;
	const counts = await Promise.all(
		userIds.map((userId) =>
			deleteThreadsForResource(
				memory,
				formatTenantMemoryResourceId(organizationId, userId)
			)
		)
	);
	return counts.reduce((sum, count) => sum + count, 0);
}

function createPgStores(
	config: MastraRuntimeConfig,
	embeddingModel: string,
	embeddingDimension: number,
	schemaName: string
): {
	memory: Memory | undefined;
	storage: PostgresStoreVNext | undefined;
	vector: PgVector | undefined;
} {
	if (!config.databaseUrl) {
		return { memory: undefined, storage: undefined, vector: undefined };
	}

	const ssl =
		config.databaseSsl || config.databaseUrl.includes("sslmode=require")
			? { rejectUnauthorized: true }
			: undefined;

	const vector = new PgVector({
		connectionString: config.databaseUrl,
		disableInit: config.disableStorageInit,
		id: "mastra-pg-vector",
		pgPoolOptions: {
			connectionTimeoutMillis: 10_000,
			max: config.maxPoolConnections ?? 5,
			...(ssl ? { ssl } : {}),
		},
		schemaName,
	});

	const storage = new PostgresStoreVNext({
		disableInit: config.disableStorageInit,
		id: "mastra-pg-store",
		observability: {
			pool: vector.pool,
			schemaName,
		},
		pool: vector.pool,
		schemaName,
	});

	const enableSemanticRecall = config.enableSemanticRecall ?? true;
	const memory = new Memory({
		...(enableSemanticRecall
			? {
					embedder: embeddingModel,
					embedderOptions: {
						providerOptions: buildEmbeddingProviderOptions(
							embeddingModel,
							embeddingDimension
						),
					},
					embeddingDimension,
					vector,
				}
			: {}),
		options: createWorkspaceMemoryOptions({ enableSemanticRecall }),
		storage,
	});

	return { memory, storage, vector };
}

/**
 * Instantiates Mastra with PostgreSQL vNext storage/observability & pgvector persistence
 * (isolated schema), provider-agnostic agent defaults, semantic recall memory, and trace context.
 */
export function createMastraRuntime(
	config: MastraRuntimeConfig = {}
): MastraRuntime {
	const model = config.defaultModel ?? DEFAULT_CHAT_MODEL;
	const embeddingModel = config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
	const embeddingDimension =
		config.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
	const schemaName = config.schemaName ?? DEFAULT_MASTRA_DB_SCHEMA;

	const { memory, storage, vector } = createPgStores(
		config,
		embeddingModel,
		embeddingDimension,
		schemaName
	);

	const knowledgeTool = createWorkspaceKnowledgeTool({
		embeddingDimension,
		embeddingModel,
		getVector: () => vector,
	});

	const workspaceAssistant = createWorkspaceAssistantAgent({
		knowledgeTool,
		memory,
		model,
	});
	const agents: Record<string, Agent> = {
		[DEFAULT_AI_AGENT_ID]: workspaceAssistant,
	};

	const observability =
		storage && !config.disableStorageInit
			? new Observability({
					configs: {
						default: {
							exporters: [new MastraStorageExporter()],
							requestContextKeys: [
								AI_CONTEXT_KEYS.organizationId,
								AI_CONTEXT_KEYS.userId,
								AI_CONTEXT_KEYS.userRole,
								AI_CONTEXT_KEYS.requestId,
							],
							serviceName: "e2e-ai-starter",
						},
					},
				})
			: undefined;

	const logger = config.disableStorageInit
		? noopLogger
		: new ConsoleLogger({
				level: MASTRA_LOG_LEVELS[config.logLevel ?? "info"],
				name: "mastra",
			});

	const mastra = new Mastra({
		agents,
		logger,
		...(storage ? { storage } : {}),
		...(observability ? { observability } : {}),
		tools: {
			workspaceContextTool,
			workspaceFilesTool,
			workspaceKnowledgeTool: knowledgeTool,
			workspaceMembersTool,
		},
		...(vector ? { vectors: { pgVector: vector } } : {}),
		workflows: {
			workspaceBriefWorkflow,
		},
	});

	const close = async (): Promise<void> => {
		await memory?.settled();
		await Promise.allSettled([
			observability?.shutdown(),
			storage?.close(),
			vector?.disconnect(),
		]);
	};

	return {
		agents,
		close,
		embeddingDimension,
		embeddingModel,
		mastra,
		memory,
		model,
		storage,
		vector,
	};
}
