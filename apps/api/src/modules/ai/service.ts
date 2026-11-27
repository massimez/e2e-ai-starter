import { handleChatStream, withSseHeartbeat } from "@mastra/ai-sdk";
import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { StorageThreadType } from "@mastra/core/memory";
import {
	type AiAgentsResponse,
	type AiChatRequest,
	type AiThreadDetailResponse,
	type AiThreadSummary,
	type AiThreadsResponse,
	createTenantRequestContext,
	DEFAULT_AI_AGENT_ID,
	formatTenantMemoryResourceId,
	getAiProviderInfo,
	type MastraRuntime,
	type WorkspaceBriefRequest,
	type WorkspaceBriefResponse,
	workspaceBriefResponseSchema,
} from "@workspace/ai-core";
import { logError, logWarning } from "@workspace/shared/logger";
import { isOrgAdminRole } from "@workspace/shared/permissions";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { type AuditLogWriter, persistAuditLog } from "../../lib/audit";
import { auth } from "../../lib/auth/index";
import { AppError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { type WalletService, walletService } from "../wallet/service";
import { type AiRepository, drizzleAiRepository } from "./repository";
import {
	assertModelProviderConfigured,
	cleanupTenantAiMemory,
	closeAiRuntime,
	ensureStorageInitialized,
	getAiRuntime,
	getAvailableAiModels,
	isAiProviderConfigured,
	isSemanticRecallEnabled,
} from "./runtime";

export {
	cleanupTenantAiMemory,
	closeAiRuntime,
	isAiProviderConfigured,
	isSemanticRecallEnabled,
} from "./runtime";

const SSE_HEARTBEAT_MS = 5000;

function assertOwnedThreadResource(params: {
	actionDescription: string;
	organizationId: string;
	resourceId: string;
	thread: StorageThreadType;
	userId: string;
}): void {
	if (params.thread.resourceId === params.resourceId) {
		return;
	}
	logWarning(
		"AIService",
		`Rejected cross-tenant AI thread ${params.actionDescription}`,
		{
			organizationId: params.organizationId,
			threadId: params.thread.id,
			userId: params.userId,
		}
	);
	throw new ForbiddenError(
		"Conversation thread does not belong to active tenant"
	);
}

async function resolveMemberRole(
	organizationId: string,
	userId: string,
	repository: AiRepository
): Promise<string> {
	const role = await repository.findMemberRole(organizationId, userId);
	if (!role) {
		throw new ForbiddenError("Active workspace membership is required");
	}
	return role;
}

function serializeThread(thread: StorageThreadType): AiThreadSummary {
	return {
		createdAt:
			thread.createdAt instanceof Date
				? thread.createdAt.toISOString()
				: String(thread.createdAt),
		id: thread.id,
		title: thread.title ?? null,
		updatedAt:
			thread.updatedAt instanceof Date
				? thread.updatedAt.toISOString()
				: String(thread.updatedAt),
	};
}

export function listAiAgents(): AiAgentsResponse {
	const runtime = getAiRuntime();
	const agents = Object.values(runtime.agents).map((agent) => ({
		description: agent.getDescription() || "Workspace assistant agent",
		id: agent.id,
		model: runtime.model,
		name: agent.name,
	}));

	return {
		agents,
		availableModels: getAvailableAiModels(),
		configured: isAiProviderConfigured(),
		defaultAgentId: DEFAULT_AI_AGENT_ID,
		model: runtime.model,
		provider: getAiProviderInfo(runtime.model),
		semanticRecall: isSemanticRecallEnabled(),
	};
}

async function checkAiOrgPermission(params: {
	action: string;
	headers: Headers;
	organizationId: string;
	resource: string;
}): Promise<boolean> {
	try {
		const result = await auth.api.hasPermission({
			body: {
				organizationId: params.organizationId,
				permissions: {
					[params.resource]: [params.action],
				},
			},
			headers: params.headers,
		});
		return Boolean(result?.success);
	} catch {
		return false;
	}
}

async function resolveTenantAiContext(
	params: {
		headers?: Headers;
		modelId?: string;
		organizationId: string;
		requestId?: string;
		userId: string;
	},
	repository: AiRepository
) {
	const userRole = await resolveMemberRole(
		params.organizationId,
		params.userId,
		repository
	);
	const headers = params.headers ?? new Headers();
	const [canReadStorage, canUpdateOrganization] = await Promise.all([
		checkAiOrgPermission({
			action: "read",
			headers,
			organizationId: params.organizationId,
			resource: "storage",
		}),
		checkAiOrgPermission({
			action: "update",
			headers,
			organizationId: params.organizationId,
			resource: "organization",
		}),
	]);
	const canReadMemberEmails = isOrgAdminRole(userRole) || canUpdateOrganization;

	return createTenantRequestContext({
		canReadMemberEmails,
		canReadStorage,
		...(params.modelId ? { modelId: params.modelId } : {}),
		organizationId: params.organizationId,
		requestId: params.requestId,
		userId: params.userId,
		userRole,
	});
}

function sanitizeUserMessages(messages: AiChatRequest["messages"]) {
	return messages.map((msg) => ({
		...(msg.id ? { id: msg.id } : {}),
		parts: msg.parts.map((part) => ({
			...(part.state ? { state: part.state } : {}),
			text: part.text,
			type: "text" as const,
		})),
		role: "user" as const,
	}));
}

async function requireOwnedThread(
	runtime: MastraRuntime,
	organizationId: string,
	userId: string,
	threadId: string,
	actionDescription: string
) {
	if (!runtime.memory) {
		throw new NotFoundError("Conversation thread not found");
	}
	await ensureStorageInitialized(runtime);

	const resourceId = formatTenantMemoryResourceId(organizationId, userId);
	const thread = await runtime.memory.getThreadById({ threadId });
	if (!thread) {
		throw new NotFoundError("Conversation thread not found");
	}
	assertOwnedThreadResource({
		actionDescription,
		organizationId,
		resourceId,
		thread,
		userId,
	});
	return { memory: runtime.memory, resourceId, thread };
}

export interface CreateAiChatParams {
	abortSignal?: AbortSignal;
	headers?: Headers;
	input: AiChatRequest;
	organizationId: string;
	requestId?: string;
	userId: string;
}

interface AiErrorDetails {
	statusCode?: number;
	text: string;
}

const AI_ERROR_RULES: ReadonlyArray<{
	keywords?: readonly string[];
	message: string;
	statusCodes?: readonly number[];
}> = [
	{
		keywords: ["rate limit", "resource_exhausted", "quota exceeded"],
		message:
			"The AI provider rate limit or quota was exceeded. Please wait a moment and try again.",
		statusCodes: [429],
	},
	{
		keywords: ["high demand", "overloaded", "unavailable"],
		message:
			"The AI model is currently experiencing high demand and is temporarily unavailable. Please try again in a moment.",
		statusCodes: [503],
	},
	{
		message:
			"The AI provider rejected the request due to an authentication or permission error. Check your provider API key configuration.",
		statusCodes: [401, 403],
	},
	{
		message:
			"The selected AI model was not found or is unavailable for this provider.",
		statusCodes: [404],
	},
	{
		keywords: ["context", "token", "too long"],
		message:
			"The conversation or prompt exceeded the model's context limit. Try starting a new thread or shortening your message.",
		statusCodes: [400, 422],
	},
	{
		message:
			"The AI provider rejected the request parameters. Please check your selected model or prompt and try again.",
		statusCodes: [400, 422],
	},
	{
		keywords: ["timeout", "timed out", "econnreset"],
		message:
			"The AI provider encountered a temporary server or network error. Please try again shortly.",
		statusCodes: [500, 502, 504],
	},
];

const DEFAULT_AI_ERROR_MESSAGE =
	"An error occurred while generating the AI response. Please try again.";

function inspectAiError(error: unknown): AiErrorDetails {
	let statusCode: number | undefined;
	const parts: string[] = [];
	let current: unknown = error;

	for (let depth = 0; depth < 5 && current; depth += 1) {
		if (typeof current === "string") {
			parts.push(current);
			break;
		}
		if (typeof current !== "object") {
			break;
		}
		const {
			cause,
			message,
			responseBody,
			status,
			statusCode: recordStatusCode,
		} = current as {
			cause?: unknown;
			message?: unknown;
			responseBody?: unknown;
			status?: unknown;
			statusCode?: unknown;
		};
		if (statusCode === undefined) {
			if (typeof recordStatusCode === "number") {
				statusCode = recordStatusCode;
			} else if (typeof status === "number") {
				statusCode = status;
			}
		}
		if (typeof message === "string") {
			parts.push(message);
		}
		if (typeof responseBody === "string") {
			parts.push(responseBody);
		}
		current = cause;
	}

	return {
		statusCode,
		text: parts.join(" ").toLowerCase(),
	};
}

export function formatAiStreamErrorMessage(
	error: unknown,
	details = inspectAiError(error)
): string {
	for (const rule of AI_ERROR_RULES) {
		const matchesStatus =
			details.statusCode !== undefined &&
			(rule.statusCodes?.includes(details.statusCode) ?? false);
		const matchesKeyword =
			rule.keywords?.some((keyword) => details.text.includes(keyword)) ?? false;

		// Rules with both statusCodes and keywords (like 400/422 context-limit) require status match if keywords are context-specific
		if (rule.statusCodes && rule.keywords && rule.statusCodes.includes(400)) {
			if (matchesStatus && matchesKeyword) {
				return rule.message;
			}
			continue;
		}
		if (matchesStatus || matchesKeyword) {
			return rule.message;
		}
	}

	return DEFAULT_AI_ERROR_MESSAGE;
}

export async function createAiChatResponse(
	params: CreateAiChatParams,
	repository: AiRepository = drizzleAiRepository
): Promise<Response> {
	const selectedModel = assertModelProviderConfigured(params.input.modelId);

	const runtime = getAiRuntime();
	const agentId = params.input.agentId ?? DEFAULT_AI_AGENT_ID;
	if (!runtime.agents[agentId]) {
		throw new NotFoundError(`AI agent '${agentId}' was not found`);
	}

	const requestContext = await resolveTenantAiContext(
		{
			headers: params.headers,
			modelId: selectedModel,
			organizationId: params.organizationId,
			requestId: params.requestId,
			userId: params.userId,
		},
		repository
	);
	await ensureStorageInitialized(runtime);

	const resourceId = formatTenantMemoryResourceId(
		params.organizationId,
		params.userId
	);
	const threadId = params.input.id ?? crypto.randomUUID();

	if (params.input.id && runtime.memory) {
		const existingThread = await runtime.memory.getThreadById({
			threadId: params.input.id,
		});
		if (existingThread) {
			assertOwnedThreadResource({
				actionDescription: "access",
				organizationId: params.organizationId,
				resourceId,
				thread: existingThread,
				userId: params.userId,
			});
		}
	}

	const sanitizedMessages = sanitizeUserMessages(params.input.messages);

	const stream = await handleChatStream({
		agentId,
		defaultOptions: {
			maxSteps: 5,
			modelSettings: { maxOutputTokens: 2048, maxRetries: 1 },
		},
		mastra: runtime.mastra,
		onError: (error) => {
			logError("AIService:ChatStream", error, {
				agentId,
				organizationId: params.organizationId,
				requestId: params.requestId,
				threadId,
				userId: params.userId,
			});
			return formatAiStreamErrorMessage(error);
		},
		params: {
			...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
			id: threadId,
			memory: {
				resource: resourceId,
				thread: threadId,
			},
			messages: sanitizedMessages as unknown as Parameters<
				typeof handleChatStream
			>[0]["params"]["messages"],
			requestContext,
			...(params.input.trigger ? { trigger: params.input.trigger } : {}),
		},
		version: "v7",
	});

	const headers: Record<string, string> = {
		"X-AI-Thread-Id": threadId,
	};
	if (params.requestId) {
		headers["X-Request-Id"] = params.requestId;
	}

	const response = createUIMessageStreamResponse({
		headers,
		stream: stream as unknown as ReadableStream<UIMessageChunk>,
	});

	return withSseHeartbeat(response, SSE_HEARTBEAT_MS);
}

export interface ListAiThreadsParams {
	limit: number;
	organizationId: string;
	page: number;
	userId: string;
}

export async function listAiThreads(
	params: ListAiThreadsParams
): Promise<AiThreadsResponse> {
	const runtime = getAiRuntime();
	if (!runtime.memory) {
		return {
			hasMore: false,
			threads: [],
			total: 0,
		};
	}

	await ensureStorageInitialized(runtime);
	const resourceId = formatTenantMemoryResourceId(
		params.organizationId,
		params.userId
	);
	const result = await runtime.memory.listThreads({
		filter: { resourceId },
		orderBy: { direction: "DESC", field: "updatedAt" },
		page: params.page,
		perPage: params.limit,
	});

	return {
		hasMore: result.hasMore,
		threads: result.threads.map(serializeThread),
		total: result.total,
	};
}

export interface GetAiThreadParams {
	organizationId: string;
	threadId: string;
	userId: string;
}

export async function getAiThread(
	params: GetAiThreadParams
): Promise<AiThreadDetailResponse> {
	const runtime = getAiRuntime();
	const { memory, resourceId, thread } = await requireOwnedThread(
		runtime,
		params.organizationId,
		params.userId,
		params.threadId,
		"access"
	);

	const recalled = await memory.recall({
		page: 0,
		perPage: 100,
		resourceId,
		threadId: params.threadId,
	});
	const messages = toAISdkMessages(recalled.messages, { version: "v7" });

	return {
		messages: messages as unknown as Record<string, unknown>[],
		thread: serializeThread(thread),
	};
}

export interface DeleteAiThreadParams {
	organizationId: string;
	threadId: string;
	userId: string;
}

export async function deleteAiThread(
	params: DeleteAiThreadParams
): Promise<{ deleted: true; id: string }> {
	const runtime = getAiRuntime();
	const { memory } = await requireOwnedThread(
		runtime,
		params.organizationId,
		params.userId,
		params.threadId,
		"deletion"
	);

	await memory.deleteThread(params.threadId);
	return { deleted: true, id: params.threadId };
}

export interface RunWorkspaceBriefParams {
	headers?: Headers;
	input: WorkspaceBriefRequest;
	operationId: string;
	organizationId: string;
	requestId?: string;
	userId: string;
}

export async function runWorkspaceBrief(
	params: RunWorkspaceBriefParams,
	repository: AiRepository = drizzleAiRepository,
	wallet: Pick<
		WalletService,
		"chargeWorkspaceBrief" | "reverseCharge"
	> = walletService,
	writeAuditLog: AuditLogWriter = persistAuditLog
): Promise<WorkspaceBriefResponse> {
	const selectedModel = assertModelProviderConfigured(params.input.modelId);

	const runtime = getAiRuntime();
	const requestContext = await resolveTenantAiContext(
		{
			headers: params.headers,
			modelId: selectedModel,
			organizationId: params.organizationId,
			requestId: params.requestId,
			userId: params.userId,
		},
		repository
	);
	await ensureStorageInitialized(runtime);

	const workflow = runtime.mastra.getWorkflowById("workspace-brief");
	const run = await workflow.createRun();
	const entryId = await wallet.chargeWorkspaceBrief({
		actorId: params.userId,
		operationId: params.operationId,
		organizationId: params.organizationId,
	});

	try {
		const result = await run.start({
			inputData: params.input,
			requestContext,
		});

		if (result.status !== "success") {
			const workflowError =
				"error" in result
					? result.error
					: new Error(
							`Workspace brief workflow ended with status ${result.status}`
						);
			logError("AIService:WorkspaceBrief", workflowError, {
				organizationId: params.organizationId,
				requestId: params.requestId,
				status: result.status,
				userId: params.userId,
			});
			const errorDetails = inspectAiError(workflowError);
			const httpStatus =
				errorDetails.statusCode === 429 || errorDetails.statusCode === 503
					? errorDetails.statusCode
					: 502;
			throw new AppError(
				formatAiStreamErrorMessage(workflowError, errorDetails),
				httpStatus,
				"AI_WORKFLOW_FAILED"
			);
		}

		return workspaceBriefResponseSchema.parse(result.result);
	} catch (error) {
		try {
			await wallet.reverseCharge({
				entryId,
				organizationId: params.organizationId,
				reason: "Workspace summary failed",
			});
		} catch (reversalError) {
			logError("AIService:WalletReversal", reversalError, {
				entryId,
				event: "wallet.reversal_failed",
				operationId: params.operationId,
				organizationId: params.organizationId,
				requestId: params.requestId,
			});
			await writeAuditLog({
				action: "ai.workspace_brief.reversal_failed",
				details: {
					chargeEntryId: entryId,
					operationId: params.operationId,
					requestId: params.requestId,
					reversalFailed: true,
				},
				entityId: entryId,
				entityType: "wallet_entry",
				organizationId: params.organizationId,
				userId: params.userId,
			});
		}
		throw error;
	}
}

export function createAiService(
	repository: AiRepository = drizzleAiRepository,
	wallet: Pick<
		WalletService,
		"chargeWorkspaceBrief" | "reverseCharge"
	> = walletService,
	writeAuditLog: AuditLogWriter = persistAuditLog
) {
	return {
		cleanupTenantAiMemory,
		closeAiRuntime,
		createAiChatResponse: (params: CreateAiChatParams) =>
			createAiChatResponse(params, repository),
		deleteAiThread,
		getAiThread,
		listAiAgents,
		listAiThreads,
		runWorkspaceBrief: (params: RunWorkspaceBriefParams) =>
			runWorkspaceBrief(params, repository, wallet, writeAuditLog),
	};
}

export const aiService = createAiService();
