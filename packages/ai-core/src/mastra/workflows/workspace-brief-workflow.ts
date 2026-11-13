import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
	DEFAULT_AI_AGENT_ID,
	tenantAiContextSchema,
	type WorkspaceBriefMetrics,
	workspaceBriefMetricsSchema,
	workspaceBriefRequestSchema,
	workspaceBriefResponseSchema,
} from "../../contracts";
import { workspaceContextTool } from "../tools/workspace-context-tool";
import { workspaceFilesTool } from "../tools/workspace-files-tool";
import { workspaceMembersTool } from "../tools/workspace-members-tool";

const gatheredStepOutputSchema = z.object({
	focus: z.string().optional(),
	metrics: workspaceBriefMetricsSchema,
});

const gatherWorkspaceMetricsStep = createStep({
	description:
		"Deterministically queries verified workspace summary, members, and recent committed files in parallel.",
	id: "gather-workspace-metrics",
	inputSchema: workspaceBriefRequestSchema,
	outputSchema: gatheredStepOutputSchema,
	requestContextSchema: tenantAiContextSchema,
	execute: async ({ inputData, requestContext }) => {
		const contextExecute = workspaceContextTool.execute;
		const membersExecute = workspaceMembersTool.execute;
		const filesExecute = workspaceFilesTool.execute;

		if (!(contextExecute && membersExecute && filesExecute)) {
			throw new Error("Workspace tools are missing execute implementations");
		}

		const [summaryResult, membersResult, filesResult] = await Promise.all([
			contextExecute({ includeStorageSummary: true }, { requestContext }),
			membersExecute({ limit: 50 }, { requestContext }),
			filesExecute({ limit: 5 }, { requestContext }),
		]);

		if (
			!summaryResult ||
			"error" in summaryResult ||
			!membersResult ||
			"error" in membersResult ||
			!filesResult ||
			"error" in filesResult
		) {
			throw new Error("Failed to gather workspace metrics from tenant tools");
		}

		const roleBreakdown: Record<string, number> = {};
		for (const item of membersResult.members) {
			roleBreakdown[item.role] = (roleBreakdown[item.role] ?? 0) + 1;
		}

		const metrics: WorkspaceBriefMetrics = {
			committedUploadCount: summaryResult.committedUploadCount ?? 0,
			memberCount: summaryResult.memberCount,
			organizationId: summaryResult.organizationId,
			organizationName: summaryResult.organizationName,
			organizationSlug: summaryResult.organizationSlug,
			recentFileNames: filesResult.files.map((file) => file.originalName),
			roleBreakdown,
			storageCurrentUsageBytes: summaryResult.storageCurrentUsageBytes ?? 0,
			storageLimitBytes: summaryResult.storageLimitBytes ?? 0,
			userRole: summaryResult.userRole,
		};

		return {
			focus: inputData.focus,
			metrics,
		};
	},
});

const synthesizeWorkspaceBriefStep = createStep({
	description:
		"Synthesizes an executive workspace brief from the gathered tenant metrics using the workspace assistant agent.",
	id: "synthesize-workspace-brief",
	inputSchema: gatheredStepOutputSchema,
	outputSchema: workspaceBriefResponseSchema,
	requestContextSchema: tenantAiContextSchema,
	execute: async ({ inputData, mastra, requestContext }) => {
		const agent = mastra.getAgentById(DEFAULT_AI_AGENT_ID);
		const focusLine = inputData.focus
			? `Focus specifically on: ${inputData.focus}`
			: "Highlight workspace identity, team composition, recent storage activity, and quota health.";

		const response = await agent.generate(
			[
				"Generate a concise, structured executive brief for the active workspace using ONLY the verified metrics below (do not call tools again):",
				JSON.stringify(inputData.metrics),
				focusLine,
			].join("\n\n"),
			{
				maxSteps: 1,
				requestContext,
			}
		);

		return {
			generatedAt: new Date().toISOString(),
			metrics: inputData.metrics,
			summary: response.text,
		};
	},
});

export const workspaceBriefWorkflow = createWorkflow({
	description:
		"Two-step tenant-isolated workflow that gathers deterministic workspace metrics and synthesizes an executive brief.",
	id: "workspace-brief",
	inputSchema: workspaceBriefRequestSchema,
	outputSchema: workspaceBriefResponseSchema,
	requestContextSchema: tenantAiContextSchema,
})
	.then(gatherWorkspaceMetricsStep)
	.then(synthesizeWorkspaceBriefStep)
	.commit();
