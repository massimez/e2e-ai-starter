import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import { db } from "@workspace/db";
import {
	createInputGuardrailProcessors,
	createMastraRuntime,
	createOutputGuardrailProcessors,
	createTenantRequestContext,
	createWorkspaceMemoryOptions,
	DEFAULT_AI_AGENT_ID,
	workspaceContextTool,
	workspaceFilesTool,
	workspaceMembersTool,
} from "../src";
import {
	AI_CONTEXT_KEYS,
	aiChatRequestSchema,
	buildEmbeddingProviderOptions,
	formatTenantMemoryResourceId,
	getAiProviderInfo,
	hasAiProviderApiKey,
	isSupportedEmbeddingModel,
	type TenantAiContext,
	tenantAiContextSchema,
} from "../src/contracts";

function mockLimitedSelect<T>(rows: T[]) {
	return {
		from: () => ({
			where: () => ({
				limit: async () => rows,
			}),
		}),
	} as unknown as ReturnType<typeof db.select>;
}

function mockDirectSelect<T>(rows: T[]) {
	return {
		from: () => ({
			where: async () => rows,
		}),
	} as unknown as ReturnType<typeof db.select>;
}

afterEach(() => {
	mock.restore();
});

describe("@workspace/ai-core contracts", () => {
	test("formatTenantMemoryResourceId builds trimmed org:user identifiers", () => {
		expect(formatTenantMemoryResourceId("  org_123 ", " user_456  ")).toBe(
			"org_123:user_456"
		);
	});

	test("formatTenantMemoryResourceId rejects blank organizationId or userId", () => {
		expect(() => formatTenantMemoryResourceId("", "user_456")).toThrow(
			"Both organizationId and userId are required to build a tenant resourceId"
		);
		expect(() => formatTenantMemoryResourceId("org_123", "   ")).toThrow(
			"Both organizationId and userId are required to build a tenant resourceId"
		);
	});

	test("tenantAiContextSchema validates required fields and optional requestId", () => {
		expect(
			tenantAiContextSchema.parse({
				organizationId: "org_1",
				requestId: "req_9",
				userId: "user_1",
				userRole: "member",
			})
		).toEqual({
			organizationId: "org_1",
			requestId: "req_9",
			userId: "user_1",
			userRole: "member",
		});

		expect(() =>
			tenantAiContextSchema.parse({
				organizationId: "",
				userId: "user_1",
				userRole: "member",
			})
		).toThrow();
	});

	test("aiChatRequestSchema rejects empty message arrays", () => {
		const valid = aiChatRequestSchema.safeParse({
			agentId: DEFAULT_AI_AGENT_ID,
			id: "thread_1",
			messages: [
				{ id: "msg_1", parts: [{ text: "Hi", type: "text" }], role: "user" },
			],
		});
		expect(valid.success).toBe(true);

		const emptyMessages = aiChatRequestSchema.safeParse({
			messages: [],
		});
		expect(emptyMessages.success).toBe(false);
	});

	test("resolves provider metadata, API keys, and embedding options for Google, OpenAI, Anthropic, and OpenRouter", () => {
		expect(getAiProviderInfo("google/gemini-2.5-flash")).toEqual({
			apiKeyEnvVars: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
			id: "google",
			label: "Google Gemini",
			supported: true,
		});
		expect(getAiProviderInfo("openai/gpt-5-mini").label).toBe("OpenAI");
		expect(getAiProviderInfo("anthropic/claude-sonnet-4-5").label).toBe(
			"Anthropic"
		);
		expect(
			getAiProviderInfo("openrouter/anthropic/claude-sonnet-4.5").label
		).toBe("OpenRouter");

		expect(
			hasAiProviderApiKey("openai/gpt-5-mini", { OPENAI_API_KEY: "sk-test" })
		).toBe(true);
		expect(
			hasAiProviderApiKey("anthropic/claude-sonnet-4-5", {
				OPENAI_API_KEY: "sk-test",
			})
		).toBe(false);
		expect(
			hasAiProviderApiKey("openrouter/anthropic/claude-sonnet-4.5", {
				OPENROUTER_API_KEY: "or-key",
			})
		).toBe(true);

		expect(isSupportedEmbeddingModel("google/gemini-embedding-001")).toBe(true);
		expect(isSupportedEmbeddingModel("openai/text-embedding-3-small")).toBe(
			true
		);
		expect(isSupportedEmbeddingModel("anthropic/claude-sonnet-4-5")).toBe(
			false
		);

		expect(
			buildEmbeddingProviderOptions("google/gemini-embedding-001", 768)
		).toEqual({
			google: { outputDimensionality: 768 },
		});
		expect(
			buildEmbeddingProviderOptions("openai/text-embedding-3-small", 1536)
		).toEqual({
			openai: { dimensions: 1536 },
		});
	});
});

describe("createTenantRequestContext", () => {
	test("populates verified tenant context keys", () => {
		const ctx = createTenantRequestContext({
			organizationId: "org_acme",
			requestId: "req_abc",
			userId: "user_alice",
			userRole: "admin",
		});

		expect(ctx.get(AI_CONTEXT_KEYS.organizationId)).toBe("org_acme");
		expect(ctx.get(AI_CONTEXT_KEYS.userId)).toBe("user_alice");
		expect(ctx.get(AI_CONTEXT_KEYS.userRole)).toBe("admin");
		expect(ctx.get(AI_CONTEXT_KEYS.requestId)).toBe("req_abc");
	});

	test("omits optional requestId when unset and rejects empty tenant fields", () => {
		const ctx = createTenantRequestContext({
			organizationId: "org_acme",
			userId: "user_alice",
			userRole: "viewer",
		});

		expect(ctx.get(AI_CONTEXT_KEYS.requestId)).toBeUndefined();
		expect(() =>
			createTenantRequestContext({
				organizationId: "",
				userId: "user_alice",
				userRole: "viewer",
			})
		).toThrow();
	});
});

function getWorkspaceToolExecute() {
	const { execute } = workspaceContextTool;
	if (!execute) {
		throw new Error("workspaceContextTool.execute is not defined");
	}
	return execute;
}

describe("workspaceContextTool", () => {
	test("rejects missing tenant fields via requestContextSchema before touching the database", async () => {
		const execute = getWorkspaceToolExecute();
		const selectSpy = spyOn(db, "select");

		const emptyResult = await execute(
			{ includeStorageSummary: true },
			{ requestContext: new RequestContext<TenantAiContext>() }
		);
		expect(emptyResult).toHaveProperty("error", true);

		const partialContext = new RequestContext<TenantAiContext>();
		partialContext.set(AI_CONTEXT_KEYS.organizationId, "org_only");
		const partialResult = await execute(
			{ includeStorageSummary: true },
			{ requestContext: partialContext }
		);
		expect(partialResult).toHaveProperty("error", true);
		expect(selectSpy).not.toHaveBeenCalled();
	});

	test("queries tenant-scoped workspace and storage summary using requestContext", async () => {
		const execute = getWorkspaceToolExecute();

		const selectSpy = spyOn(db, "select");
		selectSpy
			.mockReturnValueOnce(
				mockLimitedSelect([
					{ id: "org_acme", name: "Acme Corp", slug: "acme-corp" },
				])
			)
			.mockReturnValueOnce(mockLimitedSelect([{ role: "admin" }]))
			.mockReturnValueOnce(mockDirectSelect([{ total: 4 }]))
			.mockReturnValueOnce(
				mockLimitedSelect([{ currentUsage: 2048, storageLimit: 10_240 }])
			)
			.mockReturnValueOnce(mockDirectSelect([{ total: 2 }]));

		const requestContext = createTenantRequestContext({
			organizationId: "org_acme",
			userId: "user_alice",
			userRole: "admin",
		});

		const output = await execute(
			{ includeStorageSummary: true },
			{ requestContext }
		);

		expect(selectSpy).toHaveBeenCalledTimes(5);
		expect(output).toEqual({
			committedUploadCount: 2,
			memberCount: 4,
			organizationId: "org_acme",
			organizationName: "Acme Corp",
			organizationSlug: "acme-corp",
			storageCurrentUsageBytes: 2048,
			storageLimitBytes: 10_240,
			userRole: "admin",
		});
	});

	test("skips storage queries when includeStorageSummary is false", async () => {
		const execute = getWorkspaceToolExecute();

		const selectSpy = spyOn(db, "select");
		selectSpy
			.mockReturnValueOnce(
				mockLimitedSelect([{ id: "org_acme", name: "Acme Corp", slug: null }])
			)
			.mockReturnValueOnce(mockLimitedSelect([{ role: "member" }]))
			.mockReturnValueOnce(mockDirectSelect([{ total: 1 }]));

		const requestContext = createTenantRequestContext({
			organizationId: "org_acme",
			userId: "user_bob",
			userRole: "member",
		});

		const output = await execute(
			{ includeStorageSummary: false },
			{ requestContext }
		);

		expect(selectSpy).toHaveBeenCalledTimes(3);
		expect(output).toEqual({
			memberCount: 1,
			organizationId: "org_acme",
			organizationName: "Acme Corp",
			organizationSlug: null,
			userRole: "member",
		});
	});
});

describe("workspaceMembersTool and workspaceFilesTool", () => {
	test("lists members and searches committed files strictly within requestContext organizationId", async () => {
		const { execute: executeMembers } = workspaceMembersTool;
		const { execute: executeFiles } = workspaceFilesTool;
		if (!(executeMembers && executeFiles)) {
			throw new Error("Workspace tools are missing execute functions");
		}

		const selectSpy = spyOn(db, "select");
		selectSpy
			.mockReturnValueOnce({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							orderBy: () => ({
								limit: async () => [
									{
										createdAt: new Date("2026-11-13T10:00:00.000Z"),
										email: "alice@acme.com",
										name: "Alice",
										role: "owner",
										userId: "user_alice",
									},
								],
							}),
						}),
					}),
				}),
			} as unknown as ReturnType<typeof db.select>)
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						orderBy: () => ({
							limit: async () => [
								{
									contentType: "application/pdf",
									createdAt: new Date("2026-11-13T11:00:00.000Z"),
									fileKey: "tenants/org_acme/docs/q4-roadmap.pdf",
									id: "file_1",
									metadata: { originalName: "q4-roadmap.pdf" },
									size: 4096,
								},
							],
						}),
					}),
				}),
			} as unknown as ReturnType<typeof db.select>);

		const requestContext = createTenantRequestContext({
			organizationId: "org_acme",
			userId: "user_alice",
			userRole: "owner",
		});

		const membersOut = await executeMembers({ limit: 10 }, { requestContext });
		expect(membersOut).toEqual({
			members: [
				{
					email: "alice@acme.com",
					joinedAt: "2026-11-13T10:00:00.000Z",
					name: "Alice",
					role: "owner",
					userId: "user_alice",
				},
			],
			organizationId: "org_acme",
			returnedCount: 1,
		});

		const filesOut = await executeFiles(
			{ limit: 5, search: "roadmap" },
			{ requestContext }
		);
		expect(filesOut).toEqual({
			files: [
				{
					contentType: "application/pdf",
					createdAt: "2026-11-13T11:00:00.000Z",
					fileKey: "tenants/org_acme/docs/q4-roadmap.pdf",
					id: "file_1",
					originalName: "q4-roadmap.pdf",
					sizeBytes: 4096,
				},
			],
			organizationId: "org_acme",
			returnedCount: 1,
		});
	});
});

describe("guardrails, working memory, and createMastraRuntime", () => {
	test("configures input/output guardrail processors and resource working memory", () => {
		const inputProcessors = createInputGuardrailProcessors();
		const outputProcessors = createOutputGuardrailProcessors();
		expect(inputProcessors).toHaveLength(2);
		expect(outputProcessors).toHaveLength(1);

		const memoryWithVectors = createWorkspaceMemoryOptions({
			enableSemanticRecall: true,
		});
		expect(memoryWithVectors.workingMemory?.enabled).toBe(true);
		expect(memoryWithVectors.workingMemory?.scope).toBe("resource");
		expect(memoryWithVectors.semanticRecall).toBeTruthy();

		const memoryThreadOnly = createWorkspaceMemoryOptions({
			enableSemanticRecall: false,
		});
		expect(memoryThreadOnly.workingMemory?.enabled).toBe(true);
		expect(memoryThreadOnly.semanticRecall).toBe(false);
	});

	test("registers workspace assistant and workflow without databaseUrl", async () => {
		const runtime = createMastraRuntime();

		expect(runtime.storage).toBeUndefined();
		expect(runtime.vector).toBeUndefined();
		expect(runtime.memory).toBeUndefined();
		expect(runtime.agents[DEFAULT_AI_AGENT_ID]).toBeDefined();
		expect(runtime.mastra.getWorkflowById("workspace-brief")).toBeDefined();

		await expect(runtime.close()).resolves.toBeUndefined();
	});
});
