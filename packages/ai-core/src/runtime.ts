import type { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import {
	MastraStorageExporter,
	Observability,
	SensitiveDataFilter,
} from "@mastra/observability";
import { PgVector, PostgresStore } from "@mastra/pg";
import {
	AI_CONTEXT_KEYS,
	buildEmbeddingProviderOptions,
	DEFAULT_AI_AGENT_ID,
	DEFAULT_CHAT_MODEL,
	DEFAULT_EMBEDDING_DIMENSIONS,
	DEFAULT_EMBEDDING_MODEL,
	DEFAULT_MASTRA_DB_SCHEMA,
	type TenantAiContext,
	tenantAiContextSchema,
} from "./contracts";
import { createWorkspaceAssistantAgent } from "./mastra/agents/assistant-agent";
import { createWorkspaceMemoryOptions } from "./mastra/memory/working-memory";
import { workspaceContextTool } from "./mastra/tools/workspace-context-tool";
import { workspaceFilesTool } from "./mastra/tools/workspace-files-tool";
import { workspaceMembersTool } from "./mastra/tools/workspace-members-tool";
import { workspaceBriefWorkflow } from "./mastra/workflows/workspace-brief-workflow";

export interface MastraRuntimeConfig {
	databaseUrl?: string;
	defaultModel?: string;
	disableStorageInit?: boolean;
	embeddingDimensions?: number;
	embeddingModel?: string;
	/** Enable pgvector semantic recall (requires an API key for the embedding provider). Defaults to true. */
	enableSemanticRecall?: boolean;
	/** Maximum connections for the shared Mastra PostgreSQL pool. Defaults to 5. */
	maxPoolConnections?: number;
	schemaName?: string;
}

export interface MastraRuntime {
	agents: Record<string, Agent>;
	close: () => Promise<void>;
	mastra: Mastra;
	memory: Memory | undefined;
	model: string;
	storage: PostgresStore | undefined;
	vector: PgVector | undefined;
}

/**
 * Validates and builds a Mastra `RequestContext` populated with trusted tenant fields.
 */
export function createTenantRequestContext(
	input: TenantAiContext
): RequestContext<TenantAiContext> {
	const parsed = tenantAiContextSchema.parse(input);
	const requestContext = new RequestContext<TenantAiContext>();
	requestContext.set(AI_CONTEXT_KEYS.organizationId, parsed.organizationId);
	requestContext.set(AI_CONTEXT_KEYS.userId, parsed.userId);
	requestContext.set(AI_CONTEXT_KEYS.userRole, parsed.userRole);
	requestContext.set(
		AI_CONTEXT_KEYS.canReadStorage,
		parsed.canReadStorage ?? false
	);
	if (parsed.canReadMemberEmails !== undefined) {
		requestContext.set(
			AI_CONTEXT_KEYS.canReadMemberEmails,
			parsed.canReadMemberEmails
		);
	}
	if (parsed.requestId) {
		requestContext.set(AI_CONTEXT_KEYS.requestId, parsed.requestId);
	}
	return requestContext;
}

/**
 * Instantiates Mastra with PostgreSQL/pgvector persistence (in an isolated schema),
 * provider-agnostic agent defaults (Google Gemini unless overridden), semantic recall memory, and trace redaction.
 */
export function createMastraRuntime(
	config: MastraRuntimeConfig = {}
): MastraRuntime {
	const model = config.defaultModel ?? DEFAULT_CHAT_MODEL;
	const embeddingModel = config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
	const embeddingDimension =
		config.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
	const schemaName = config.schemaName ?? DEFAULT_MASTRA_DB_SCHEMA;

	let storage: PostgresStore | undefined;
	let vector: PgVector | undefined;
	let memory: Memory | undefined;

	if (config.databaseUrl) {
		const maxPoolConnections = config.maxPoolConnections ?? 5;
		vector = new PgVector({
			connectionString: config.databaseUrl,
			disableInit: config.disableStorageInit,
			id: "mastra-pg-vector",
			pgPoolOptions: {
				max: maxPoolConnections,
			},
			schemaName,
		});
		storage = new PostgresStore({
			disableInit: config.disableStorageInit,
			id: "mastra-pg-store",
			pool: vector.pool,
			schemaName,
		});
		// Embedders are resolved eagerly and throw without a provider API key, so
		// semantic recall is only wired when the caller confirms one is configured.
		const enableSemanticRecall = config.enableSemanticRecall ?? true;
		memory = new Memory({
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
	}

	const workspaceAssistant = createWorkspaceAssistantAgent({
		memory,
		model,
	});
	const agents: Record<string, Agent> = {
		[DEFAULT_AI_AGENT_ID]: workspaceAssistant,
	};

	// Mastra requires at least one exporter, so tracing is only enabled when
	// PostgreSQL storage is active and background storage init is not disabled.
	const observability =
		storage && !config.disableStorageInit
			? new Observability({
					configs: {
						default: {
							exporters: [new MastraStorageExporter()],
							serviceName: "e2e-ai-starter",
							spanOutputProcessors: [new SensitiveDataFilter()],
						},
					},
				})
			: undefined;

	const mastra = new Mastra({
		agents,
		...(storage ? { storage } : {}),
		...(observability ? { observability } : {}),
		tools: {
			workspaceContextTool,
			workspaceFilesTool,
			workspaceMembersTool,
		},
		...(vector ? { vectors: { pgVector: vector } } : {}),
		workflows: {
			workspaceBriefWorkflow,
		},
	});

	const close = async (): Promise<void> => {
		if (memory) {
			await memory.settled();
		}
		await Promise.allSettled([
			observability ? observability.shutdown() : Promise.resolve(),
			(async () => {
				if (storage) {
					await storage.close();
				}
				if (vector) {
					await vector.disconnect();
				}
			})(),
		]);
	};

	return {
		agents,
		close,
		mastra,
		memory,
		model,
		storage,
		vector,
	};
}
