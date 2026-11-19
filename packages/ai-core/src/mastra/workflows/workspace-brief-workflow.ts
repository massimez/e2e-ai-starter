import { createStep, createWorkflow } from "@mastra/core/workflows";
import { db } from "@workspace/db";
import { member } from "@workspace/db/schema";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import {
	AI_CONTEXT_KEYS,
	DEFAULT_AI_AGENT_ID,
	tenantAiContextSchema,
	type WorkspaceBriefMetrics,
	workspaceBriefMetricsSchema,
	workspaceBriefRequestSchema,
	workspaceBriefResponseSchema,
	workspaceBriefStructuredOutputSchema,
} from "../../contracts";
import { workspaceContextTool } from "../tools/workspace-context-tool";
import { workspaceFilesTool } from "../tools/workspace-files-tool";

const gatheredStepOutputSchema = z.object({
	focus: z.string().optional(),
	metrics: workspaceBriefMetricsSchema,
});

function extractToolErrorMessage(result: unknown): string | undefined {
	if (
		typeof result === "object" &&
		result !== null &&
		"error" in result &&
		result.error
	) {
		const record = result as Record<string, unknown>;
		if (
			typeof record.message === "string" &&
			record.message.trim().length > 0
		) {
			return record.message.trim();
		}
		if (typeof record.error === "string" && record.error.trim().length > 0) {
			return record.error.trim();
		}
		return "Workspace tool returned an error";
	}
	return undefined;
}

const gatherWorkspaceMetricsStep = createStep({
	description:
		"Deterministically queries verified workspace summary, role breakdown, and recent committed files in parallel.",
	id: "gather-workspace-metrics",
	inputSchema: workspaceBriefRequestSchema,
	outputSchema: gatheredStepOutputSchema,
	requestContextSchema: tenantAiContextSchema,
	execute: async ({ inputData, requestContext }) => {
		const contextExecute = workspaceContextTool.execute;
		const filesExecute = workspaceFilesTool.execute;

		if (!(contextExecute && filesExecute)) {
			throw new Error("Workspace tools are missing execute implementations");
		}

		const canReadStorage =
			requestContext.get(AI_CONTEXT_KEYS.canReadStorage) === true;

		const [summaryResult, filesResult] = await Promise.all([
			contextExecute(
				{ includeStorageSummary: canReadStorage },
				{ requestContext }
			),
			canReadStorage
				? filesExecute({ limit: 5 }, { requestContext })
				: Promise.resolve(null),
		]);

		const summaryError = extractToolErrorMessage(summaryResult);
		if (!summaryResult || summaryError || "error" in summaryResult) {
			throw new Error(
				summaryError ?? "Failed to gather workspace summary from tenant tool"
			);
		}

		if (canReadStorage) {
			const filesError = extractToolErrorMessage(filesResult);
			if (!filesResult || filesError || "error" in filesResult) {
				throw new Error(
					filesError ?? "Failed to gather workspace files from tenant tool"
				);
			}
		}

		const roleRows = await db
			.select({
				role: member.role,
				total: count(),
			})
			.from(member)
			.where(eq(member.organizationId, summaryResult.organizationId))
			.groupBy(member.role);

		const roleBreakdown: Record<string, number> = {};
		for (const row of roleRows) {
			roleBreakdown[row.role] = row.total;
		}

		const recentFileNames =
			canReadStorage && filesResult && !("error" in filesResult)
				? filesResult.files.map((file) => file.originalName)
				: [];

		const metrics: WorkspaceBriefMetrics = {
			committedUploadCount: summaryResult.committedUploadCount ?? 0,
			memberCount: summaryResult.memberCount,
			organizationId: summaryResult.organizationId,
			organizationName: summaryResult.organizationName,
			organizationSlug: summaryResult.organizationSlug,
			recentFileNames,
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
				structuredOutput: {
					schema: workspaceBriefStructuredOutputSchema,
				},
				toolChoice: "none",
			}
		);

		const structured = response.object;
		return {
			generatedAt: new Date().toISOString(),
			highlights: structured?.highlights ?? [],
			metrics: inputData.metrics,
			recommendedActions: structured?.recommendedActions ?? [],
			risks: structured?.risks ?? [],
			summary: structured?.summary ?? response.text,
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
