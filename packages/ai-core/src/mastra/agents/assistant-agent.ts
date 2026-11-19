import { Agent, type ToolsInput } from "@mastra/core/agent";
import type { MastraMemory } from "@mastra/core/memory";
import {
	AI_CONTEXT_KEYS,
	DEFAULT_AI_AGENT_ID,
	DEFAULT_CHAT_MODEL,
	tenantAiContextSchema,
} from "../../contracts";
import {
	createInputGuardrailProcessors,
	createOutputGuardrailProcessors,
} from "../processors/guardrails";
import { workspaceContextTool } from "../tools/workspace-context-tool";
import { workspaceFilesTool } from "../tools/workspace-files-tool";
import { workspaceMembersTool } from "../tools/workspace-members-tool";

export interface WorkspaceAssistantOptions {
	memory?: MastraMemory;
	model?: string;
}

const BASE_INSTRUCTIONS = [
	"You are the multi-tenant workspace assistant for E2E AI Starter.",
	"Never claim access to other organizations, raw secrets, credentials, or host filesystem resources.",
	"Keep responses clear, concise, and actionable.",
].join(" ");

/**
 * Builds the primary tenant-aware workspace assistant agent backed by the configured chat model (Google Gemini by default).
 */
export function createWorkspaceAssistantAgent(
	options: WorkspaceAssistantOptions = {}
): Agent {
	return new Agent({
		defaultOptions: {
			maxSteps: 5,
		},
		description:
			"Tenant-scoped assistant for workspace questions, member directory, file search, storage summary, and multi-turn memory.",
		id: DEFAULT_AI_AGENT_ID,
		inputProcessors: createInputGuardrailProcessors(),
		instructions: ({ requestContext }) => {
			const organizationId = requestContext.get(AI_CONTEXT_KEYS.organizationId);
			const userRole = requestContext.get(AI_CONTEXT_KEYS.userRole);
			const canReadStorage =
				requestContext.get(AI_CONTEXT_KEYS.canReadStorage) === true;
			const allowedTools = canReadStorage
				? "workspaceContextTool, workspaceMembersTool, or workspaceFilesTool"
				: "workspaceContextTool or workspaceMembersTool";
			const groundingLine = `When tools are available, ground answers about the user's current workspace, membership role, team roster, or committed files by calling ${allowedTools} instead of guessing.`;

			if (organizationId && userRole) {
				return `${BASE_INSTRUCTIONS} ${groundingLine} Active context: organizationId=${organizationId}, callerRole=${userRole}.`;
			}
			return `${BASE_INSTRUCTIONS} ${groundingLine}`;
		},
		memory: options.memory,
		model: options.model ?? DEFAULT_CHAT_MODEL,
		name: "Workspace Assistant",
		outputProcessors: createOutputGuardrailProcessors(),
		requestContextSchema: tenantAiContextSchema,
		tools: ({ requestContext }): ToolsInput => {
			const canReadStorage =
				requestContext.get(AI_CONTEXT_KEYS.canReadStorage) === true;
			const tools: ToolsInput = {
				workspaceContextTool,
				workspaceMembersTool,
			};
			if (canReadStorage) {
				tools.workspaceFilesTool = workspaceFilesTool;
			}
			return tools;
		},
	});
}
