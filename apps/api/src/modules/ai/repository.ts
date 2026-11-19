import { db } from "@workspace/db";
import { member } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Builds the Drizzle-backed repository for AI service queries.
 */
export function createDrizzleAiRepository(database = db) {
	return {
		async findMemberRole(
			organizationId: string,
			userId: string
		): Promise<string | null> {
			const [membership] = await database
				.select({ role: member.role })
				.from(member)
				.where(
					and(
						eq(member.organizationId, organizationId),
						eq(member.userId, userId)
					)
				)
				.limit(1);

			return membership?.role ?? null;
		},
	};
}

export type AiRepository = ReturnType<typeof createDrizzleAiRepository>;

export const drizzleAiRepository = createDrizzleAiRepository();
