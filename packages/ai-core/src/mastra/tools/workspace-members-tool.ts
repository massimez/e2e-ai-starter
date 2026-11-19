import { createTool } from "@mastra/core/tools";
import { db } from "@workspace/db";
import { member, user } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { tenantAiContextSchema } from "../../contracts";
import { requireTenantMembership, toIsoString } from "./tenant-auth";

const workspaceMembersInputSchema = z.object({
	limit: z.number().int().min(1).max(50).optional().default(20),
});

const workspaceMemberItemSchema = z.object({
	email: z.string().optional(),
	joinedAt: z.string(),
	name: z.string(),
	role: z.string(),
	userId: z.string(),
});

const workspaceMembersOutputSchema = z.object({
	members: z.array(workspaceMemberItemSchema),
	organizationId: z.string(),
	returnedCount: z.number().int().nonnegative(),
});

/**
 * Read-only tool that lists members of the caller's active organization.
 *
 * Validated by `requestContextSchema: tenantAiContextSchema` so `organizationId`
 * is guaranteed to come from the server-verified session.
 */
export const workspaceMembersTool = createTool({
	description:
		"List members and roles in the active workspace (up to 50 members).",
	id: "list-workspace-members",
	inputSchema: workspaceMembersInputSchema,
	outputSchema: workspaceMembersOutputSchema,
	requestContextSchema: tenantAiContextSchema,
	execute: async (inputData, context) => {
		const { canReadMemberEmails, organizationId } =
			await requireTenantMembership(context?.requestContext);

		const rows = await db
			.select({
				createdAt: member.createdAt,
				email: user.email,
				name: user.name,
				role: member.role,
				userId: member.userId,
			})
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, organizationId))
			.orderBy(asc(member.createdAt))
			.limit(inputData.limit ?? 20);

		const members = rows.map((row) => ({
			...(canReadMemberEmails ? { email: row.email } : {}),
			joinedAt: toIsoString(row.createdAt),
			name: row.name,
			role: row.role,
			userId: row.userId,
		}));

		return {
			members,
			organizationId,
			returnedCount: members.length,
		};
	},
});
