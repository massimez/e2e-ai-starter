import type { RequestContext } from "@mastra/core/request-context";
import { db } from "@workspace/db";
import { member } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { AI_CONTEXT_KEYS, type TenantAiContext } from "../../contracts";

export interface VerifiedTenantContext {
	canReadMemberEmails: boolean;
	canReadStorage: boolean;
	memberRole: string;
	organizationId: string;
	userId: string;
}

const EMAIL_READ_ADMIN_ROLES = new Set(["admin", "owner"]);

/**
 * Verifies required tenant identifiers from `RequestContext` and confirms active
 * workspace membership in PostgreSQL before any tenant tool returns data.
 */
export async function requireTenantMembership(
	requestContext: RequestContext<TenantAiContext> | undefined
): Promise<VerifiedTenantContext> {
	const organizationId = requestContext?.get(AI_CONTEXT_KEYS.organizationId);
	const userId = requestContext?.get(AI_CONTEXT_KEYS.userId);
	if (!(organizationId && userId)) {
		throw new Error(
			"Tenant organizationId and userId are required in requestContext"
		);
	}

	const [membershipRow] = await db
		.select({ role: member.role })
		.from(member)
		.where(
			and(eq(member.organizationId, organizationId), eq(member.userId, userId))
		)
		.limit(1);

	if (!membershipRow) {
		throw new Error("Active user is not a member of the requested workspace");
	}

	const explicitEmailFlag = requestContext?.get(
		AI_CONTEXT_KEYS.canReadMemberEmails
	);
	const canReadMemberEmails =
		typeof explicitEmailFlag === "boolean"
			? explicitEmailFlag
			: EMAIL_READ_ADMIN_ROLES.has(membershipRow.role);

	return {
		canReadMemberEmails,
		canReadStorage:
			requestContext?.get(AI_CONTEXT_KEYS.canReadStorage) === true,
		memberRole: membershipRow.role,
		organizationId,
		userId,
	};
}

/**
 * Escapes SQL LIKE/ILIKE wildcards (`\`, `%`, `_`) so user search terms match literally.
 */
export function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/gu, "\\$&");
}
