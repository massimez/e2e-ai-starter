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
import { db } from "@workspace/db";
import { member } from "@workspace/db/schema";
import { logError, logWarning } from "@workspace/shared/logger";
import { isOrgAdminRole } from "@workspace/shared/permissions";
import { createUIMessageStreamResponse } from "ai";
import { and, eq } from "drizzle-orm";
import { auth } from "../../lib/auth/index";
import { AppError, ForbiddenError, NotFoundError } from "../../lib/errors";
import {
	assertAiProviderConfigured,
	cleanupTenantAiMemory,
	closeAiRuntime,
	ensureStorageInitialized,
	getAiRuntime,
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
	userId: string
): Promise<string> {
	const [membership] = await db
		.select({ role: member.role })
		.from(member)
		.where(
			and(eq(member.organizationId, organizationId), eq(member.userId, userId))
		)
		.limit(1);

	if (!membership) {
		throw new ForbiddenError("Active workspace membership is required");
	}
	return membership.role;
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

async function resolveTenantAiContext(params: {
	headers?: Headers;
	organizationId: string;
	requestId?: string;
	userId: string;
}) {
	const userRole = await resolveMemberRole(
		params.organizationId,
		params.userId
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

export async function createAiChatResponse(
	params: CreateAiChatParams
): Promise<Response> {
	assertAiProviderConfigured();

	const runtime = getAiRuntime();
	const agentId = params.input.agentId ?? DEFAULT_AI_AGENT_ID;
	if (!runtime.agents[agentId]) {
		throw new NotFoundError(`AI agent '${agentId}' was not found`);
	}

	const requestContext = await resolveTenantAiContext({
		headers: params.headers,
		organizationId: params.organizationId,
		requestId: params.requestId,
		userId: params.userId,
	});
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
			return "An error occurred while generating the AI response.";
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
		stream: stream as unknown as Parameters<
			typeof createUIMessageStreamResponse
		>[0]["stream"],
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
	organizationId: string;
	requestId?: string;
	userId: string;
}

export async function runWorkspaceBrief(
	params: RunWorkspaceBriefParams
): Promise<WorkspaceBriefResponse> {
	assertAiProviderConfigured();

	const runtime = getAiRuntime();
	const requestContext = await resolveTenantAiContext({
		headers: params.headers,
		organizationId: params.organizationId,
		requestId: params.requestId,
		userId: params.userId,
	});
	await ensureStorageInitialized(runtime);

	const workflow = runtime.mastra.getWorkflowById("workspace-brief");
	const run = await workflow.createRun();
	const result = await run.start({
		inputData: params.input,
		requestContext,
	});

	if (result.status !== "success") {
		logError(
			"AIService:WorkspaceBrief",
			"error" in result
				? result.error
				: new Error(
						`Workspace brief workflow ended with status ${result.status}`
					),
			{
				organizationId: params.organizationId,
				requestId: params.requestId,
				status: result.status,
				userId: params.userId,
			}
		);
		throw new AppError(
			"Workspace brief workflow failed to complete",
			502,
			"AI_WORKFLOW_FAILED"
		);
	}

	return workspaceBriefResponseSchema.parse(result.result);
}

export const aiService = {
	cleanupTenantAiMemory,
	closeAiRuntime,
	createAiChatResponse,
	deleteAiThread,
	getAiThread,
	listAiAgents,
	listAiThreads,
	runWorkspaceBrief,
};
