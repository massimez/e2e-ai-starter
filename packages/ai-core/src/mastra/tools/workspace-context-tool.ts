import { createTool } from "@mastra/core/tools";
import { db } from "@workspace/db";
import {
	member,
	organization,
	organizationStorageLimits,
	uploads,
} from "@workspace/db/schema";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { AI_CONTEXT_KEYS, tenantAiContextSchema } from "../../contracts";

const workspaceContextInputSchema = z.object({
	includeStorageSummary: z
		.boolean()
		.optional()
		.default(true)
		.describe("Whether to include committed file count and quota usage."),
});

const workspaceContextOutputSchema = z.object({
	committedUploadCount: z.number().int().nonnegative().optional(),
	memberCount: z.number().int().nonnegative(),
	organizationId: z.string(),
	organizationName: z.string(),
	organizationSlug: z.string().nullable(),
	storageCurrentUsageBytes: z.number().int().nonnegative().optional(),
	storageLimitBytes: z.number().int().nonnegative().optional(),
	userRole: z.string(),
});

/**
 * Read-only tool that returns verified tenant context for the active request.
 *
 * Tenant identifiers are read exclusively from the server-populated `requestContext`
 * and never accepted as model tool arguments.
 */
export const workspaceContextTool = createTool({
	description:
		"Inspect the active workspace's name, slug, member count, caller role, and storage quota usage.",
	id: "get-workspace-context",
	inputSchema: workspaceContextInputSchema,
	outputSchema: workspaceContextOutputSchema,
	requestContextSchema: tenantAiContextSchema,
	execute: async (inputData, context) => {
		const organizationId = context?.requestContext?.get(
			AI_CONTEXT_KEYS.organizationId
		);
		const userId = context?.requestContext?.get(AI_CONTEXT_KEYS.userId);
		if (!(organizationId && userId)) {
			throw new Error(
				"Tenant organizationId and userId are required in requestContext"
			);
		}

		const [orgRow] = await db
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
			})
			.from(organization)
			.where(eq(organization.id, organizationId))
			.limit(1);

		if (!orgRow) {
			throw new Error(`Workspace ${organizationId} was not found`);
		}

		const [membershipRow] = await db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.organizationId, organizationId),
					eq(member.userId, userId)
				)
			)
			.limit(1);

		if (!membershipRow) {
			throw new Error("Active user is not a member of the requested workspace");
		}

		const [memberStats] = await db
			.select({ total: count() })
			.from(member)
			.where(eq(member.organizationId, organizationId));

		const result: z.infer<typeof workspaceContextOutputSchema> = {
			memberCount: memberStats?.total ?? 0,
			organizationId: orgRow.id,
			organizationName: orgRow.name,
			organizationSlug: orgRow.slug,
			userRole: membershipRow.role,
		};

		if (inputData.includeStorageSummary) {
			const [quotaRow] = await db
				.select({
					currentUsage: organizationStorageLimits.currentUsage,
					storageLimit: organizationStorageLimits.storageLimit,
				})
				.from(organizationStorageLimits)
				.where(eq(organizationStorageLimits.organizationId, organizationId))
				.limit(1);

			const [uploadStats] = await db
				.select({ total: count() })
				.from(uploads)
				.where(
					and(
						eq(uploads.organizationId, organizationId),
						eq(uploads.status, "committed")
					)
				);

			result.committedUploadCount = uploadStats?.total ?? 0;
			result.storageCurrentUsageBytes = quotaRow?.currentUsage ?? 0;
			result.storageLimitBytes = quotaRow?.storageLimit ?? 0;
		}

		return result;
	},
});
