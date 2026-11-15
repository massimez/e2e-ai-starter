import { createTool } from "@mastra/core/tools";
import { db } from "@workspace/db";
import { uploads } from "@workspace/db/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { tenantAiContextSchema } from "../../contracts";
import { escapeLikePattern, requireTenantMembership } from "./tenant-auth";

const workspaceFilesInputSchema = z.object({
	limit: z.number().int().min(1).max(50).optional().default(15),
	search: z
		.string()
		.trim()
		.max(120)
		.optional()
		.describe("Optional case-insensitive file key substring filter."),
});

const workspaceFileItemSchema = z.object({
	contentType: z.string(),
	createdAt: z.string(),
	fileKey: z.string(),
	id: z.string(),
	originalName: z.string(),
	sizeBytes: z.number().int().nonnegative(),
});

const workspaceFilesOutputSchema = z.object({
	files: z.array(workspaceFileItemSchema),
	organizationId: z.string(),
	returnedCount: z.number().int().nonnegative(),
});

function resolveOriginalName(
	fileKey: string,
	metadata: Record<string, unknown> | null | undefined
): string {
	const metaName = metadata?.originalName;
	if (typeof metaName === "string" && metaName.trim().length > 0) {
		return metaName.trim();
	}
	const segments = fileKey.split("/");
	return segments.at(-1) || fileKey;
}

/**
 * Read-only tool that searches committed storage files in the active workspace.
 */
export const workspaceFilesTool = createTool({
	description:
		"Search or list committed files uploaded to the active workspace's private storage.",
	id: "search-workspace-files",
	inputSchema: workspaceFilesInputSchema,
	outputSchema: workspaceFilesOutputSchema,
	requestContextSchema: tenantAiContextSchema,
	execute: async (inputData, context) => {
		const { canReadStorage, organizationId } = await requireTenantMembership(
			context?.requestContext
		);
		if (!canReadStorage) {
			throw new Error(
				"Storage read permission is required to search workspace files"
			);
		}

		const searchQuery = inputData.search?.trim();
		const escapedPattern = searchQuery
			? `%${escapeLikePattern(searchQuery)}%`
			: undefined;
		const whereClause = escapedPattern
			? and(
					eq(uploads.organizationId, organizationId),
					eq(uploads.status, "committed"),
					or(
						sql`${uploads.fileKey} ILIKE ${escapedPattern} ESCAPE '\\'`,
						sql`coalesce(${uploads.metadata}->>'originalName', '') ILIKE ${escapedPattern} ESCAPE '\\'`
					)
				)
			: and(
					eq(uploads.organizationId, organizationId),
					eq(uploads.status, "committed")
				);

		const rows = await db
			.select({
				contentType: uploads.contentType,
				createdAt: uploads.createdAt,
				fileKey: uploads.fileKey,
				id: uploads.id,
				metadata: uploads.metadata,
				size: uploads.size,
			})
			.from(uploads)
			.where(whereClause)
			.orderBy(desc(uploads.createdAt))
			.limit(inputData.limit ?? 15);

		const files = rows.map((row) => ({
			contentType: row.contentType ?? "application/octet-stream",
			createdAt:
				row.createdAt instanceof Date
					? row.createdAt.toISOString()
					: String(row.createdAt),
			fileKey: row.fileKey,
			id: row.id,
			originalName: resolveOriginalName(row.fileKey, row.metadata),
			sizeBytes: row.size ?? 0,
		}));

		return {
			files,
			organizationId,
			returnedCount: files.length,
		};
	},
});
