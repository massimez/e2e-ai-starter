import {
	type AiModelOption,
	createMastraRuntime,
	deleteTenantMemoryData,
	deleteWorkspaceKnowledgeForUpload,
	getAiProviderInfo,
	hasAiProviderApiKey,
	indexWorkspaceUploadKnowledge,
	isSupportedEmbeddingModel,
	listAvailableAiModels,
	type MastraRuntime,
} from "@workspace/ai-core";
import { env } from "../../env";
import { AppError, ValidationError } from "../../lib/errors";

interface GlobalAiRuntimeCache {
	_aiRuntime?: MastraRuntime | null;
	_aiRuntimeStorageInit?: Promise<void> | null;
}

const globalForAi = globalThis as unknown as GlobalAiRuntimeCache;

function resolveMastraLogLevel(
	level: typeof env.LOG_LEVEL
): "debug" | "info" | "warn" | "error" | undefined {
	if (
		level === "debug" ||
		level === "info" ||
		level === "warn" ||
		level === "error"
	) {
		return level;
	}
	return undefined;
}

function getProviderKeyValues(): Record<string, string | undefined> {
	return {
		ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
		GOOGLE_API_KEY: env.GOOGLE_API_KEY,
		GOOGLE_GENERATIVE_AI_API_KEY: env.GOOGLE_GENERATIVE_AI_API_KEY,
		OPENAI_API_KEY: env.OPENAI_API_KEY,
		OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
	};
}

/** Semantic recall needs a supported embedding model plus its provider key. */
export function isSemanticRecallEnabled(): boolean {
	return (
		isSupportedEmbeddingModel(env.MASTRA_EMBEDDING_MODEL) &&
		hasAiProviderApiKey(env.MASTRA_EMBEDDING_MODEL, getProviderKeyValues())
	);
}

/** Whether an API key is set for the provider behind `MASTRA_DEFAULT_MODEL`. */
export function isAiProviderConfigured(): boolean {
	return hasAiProviderApiKey(env.MASTRA_DEFAULT_MODEL, getProviderKeyValues());
}

export function assertAiProviderConfigured(): void {
	assertModelProviderConfigured(env.MASTRA_DEFAULT_MODEL);
}

export function assertModelProviderConfigured(requestedModel?: string): string {
	const targetModel = requestedModel?.trim() || env.MASTRA_DEFAULT_MODEL;
	const allowedModel = getAvailableAiModels().find(
		(option) => option.id === targetModel
	);
	if (!allowedModel) {
		throw new ValidationError(
			`Unsupported AI model "${targetModel}"`,
			"modelId"
		);
	}
	if (allowedModel.configured) {
		return allowedModel.id;
	}
	const provider = getAiProviderInfo(allowedModel.id);
	throw new AppError(
		`${provider.label} API key is not configured for ${allowedModel.id}. Set ${provider.apiKeyEnvVars.join(" or ")} to enable workspace AI.`,
		503,
		"AI_NOT_CONFIGURED"
	);
}

export function getAvailableAiModels(): AiModelOption[] {
	return listAvailableAiModels(
		env.MASTRA_DEFAULT_MODEL,
		getProviderKeyValues()
	);
}

export function getAiRuntime(): MastraRuntime {
	if (!globalForAi._aiRuntime) {
		globalForAi._aiRuntime = createMastraRuntime({
			databaseSsl: env.DATABASE_SSL,
			databaseUrl: env.DATABASE_URL,
			defaultModel: env.MASTRA_DEFAULT_MODEL,
			disableStorageInit: env.NODE_ENV === "test",
			embeddingDimensions: env.MASTRA_EMBEDDING_DIMENSIONS,
			embeddingModel: env.MASTRA_EMBEDDING_MODEL,
			enableSemanticRecall: isSemanticRecallEnabled(),
			logLevel: resolveMastraLogLevel(env.LOG_LEVEL),
			schemaName: env.MASTRA_DB_SCHEMA,
		});
	}
	return globalForAi._aiRuntime;
}

export async function ensureStorageInitialized(
	runtime: MastraRuntime
): Promise<void> {
	const { storage } = runtime;
	if (!storage || env.NODE_ENV === "test") {
		return;
	}
	if (!globalForAi._aiRuntimeStorageInit) {
		globalForAi._aiRuntimeStorageInit = (async () => {
			await storage.init();
			await storage.ensurePartitions();
		})().catch((error: unknown) => {
			globalForAi._aiRuntimeStorageInit = null;
			throw error;
		});
	}
	await globalForAi._aiRuntimeStorageInit;
}

export async function closeAiRuntime(): Promise<void> {
	if (!globalForAi._aiRuntime) {
		return;
	}
	const runtimeToClose = globalForAi._aiRuntime;
	const pendingInit = globalForAi._aiRuntimeStorageInit;
	globalForAi._aiRuntime = null;
	globalForAi._aiRuntimeStorageInit = null;
	if (pendingInit) {
		await Promise.allSettled([pendingInit]);
	}
	await runtimeToClose.close();
}

export async function cleanupTenantAiMemory(
	organizationId: string,
	userIds: readonly string[],
	options?: { deleteOrganizationKnowledge?: boolean }
): Promise<number> {
	const runtime = getAiRuntime();
	if (options?.deleteOrganizationKnowledge && runtime.vector) {
		await deleteWorkspaceKnowledgeForUpload({
			organizationId,
			vector: runtime.vector,
		});
	}
	if (userIds.length === 0 || !runtime.memory) {
		return 0;
	}
	await ensureStorageInitialized(runtime);
	return await deleteTenantMemoryData({
		organizationId,
		runtime,
		userIds,
	});
}

export async function indexUploadKnowledgeInMastra(params: {
	content: string;
	fileName: string;
	organizationId: string;
	uploadId: string;
}): Promise<{ chunkCount: number; indexed: boolean }> {
	if (!isSemanticRecallEnabled()) {
		return { chunkCount: 0, indexed: false };
	}
	const runtime = getAiRuntime();
	if (!runtime.vector) {
		return { chunkCount: 0, indexed: false };
	}
	await ensureStorageInitialized(runtime);
	const { chunkCount } = await indexWorkspaceUploadKnowledge({
		content: params.content,
		embeddingDimension: runtime.embeddingDimension,
		embeddingModel: runtime.embeddingModel,
		fileName: params.fileName,
		organizationId: params.organizationId,
		uploadId: params.uploadId,
		vector: runtime.vector,
	});
	return { chunkCount, indexed: chunkCount > 0 };
}

export async function deleteUploadKnowledgeFromMastra(params: {
	organizationId: string;
	uploadId: string;
}): Promise<void> {
	const runtime = getAiRuntime();
	await deleteWorkspaceKnowledgeForUpload({
		organizationId: params.organizationId,
		uploadId: params.uploadId,
		vector: runtime.vector,
	});
}
