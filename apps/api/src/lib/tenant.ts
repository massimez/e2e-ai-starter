import { and, type Column, eq, isNull, type SQL } from "drizzle-orm";
import { AuthError, ValidationError } from "./errors";

export interface TenantScopedTable {
	organizationId: Column;
}

export interface SoftDeletableTenantTable extends TenantScopedTable {
	deletedAt: Column;
}

export interface ActiveTenantContext {
	organizationId: string;
	userId: string;
}

export interface TenantMismatchSecurityEvent {
	activeOrganizationId: string;
	attemptedOrganizationId: string;
	reason: "CROSS_TENANT_MISMATCH";
	source: "body" | "header" | "param" | "query";
}

interface SessionLike {
	activeOrganizationId?: string | null;
	userId?: string | null;
}

interface UserLike {
	id?: string | null;
}

export interface ContextVariableReader {
	get: (key: "session" | "user") => unknown;
}

export function validateOrgId(orgId: string | undefined): string {
	if (!orgId || typeof orgId !== "string" || orgId.trim() === "") {
		throw new ValidationError(
			"Valid organization ID is required",
			"organizationId"
		);
	}
	return orgId.trim();
}

/**
 * Extracts and validates the active organization ID from the verified server session.
 * Throws ValidationError (400) if no activeOrganizationId is present on the session.
 */
export function requireActiveOrgId(c: ContextVariableReader): string {
	const session = c.get("session") as SessionLike | null | undefined;
	return validateOrgId(session?.activeOrganizationId ?? undefined);
}

/**
 * Extracts and validates both the active organization ID and authenticated user ID
 * from the verified server session.
 */
export function getActiveOrgContext(
	c: ContextVariableReader
): ActiveTenantContext {
	const session = c.get("session") as SessionLike | null | undefined;
	const user = c.get("user") as UserLike | null | undefined;
	const organizationId = validateOrgId(
		session?.activeOrganizationId ?? undefined
	);
	const userId = user?.id ?? session?.userId ?? undefined;

	if (!userId || typeof userId !== "string") {
		throw new AuthError("Authentication required");
	}

	return {
		organizationId,
		userId,
	};
}

/**
 * Returns a strict equality predicate `eq(table.organizationId, orgId)`
 * after validating that `orgId` is non-empty.
 */
export function scopedWhere<T extends TenantScopedTable>(
	table: T,
	orgId: string | undefined
): SQL {
	const validatedOrgId = validateOrgId(orgId);
	return eq(table.organizationId, validatedOrgId);
}

/**
 * Combines `eq(table.organizationId, orgId)` with additional SQL conditions
 * so every query is scoped to the tenant by construction.
 */
export function withOrg<T extends TenantScopedTable>(
	table: T,
	orgId: string | undefined,
	...conditions: Array<SQL | undefined>
): SQL {
	const orgCondition = scopedWhere(table, orgId);
	const definedConditions = conditions.filter(
		(condition): condition is SQL => condition !== undefined
	);

	if (definedConditions.length === 0) {
		return orgCondition;
	}

	return and(orgCondition, ...definedConditions) ?? orgCondition;
}

/**
 * Combines `eq(table.organizationId, orgId)` and `isNull(table.deletedAt)`
 * with additional SQL conditions for soft-deletable tenant tables.
 */
export function withActiveOrg<T extends SoftDeletableTenantTable>(
	table: T,
	orgId: string | undefined,
	...conditions: Array<SQL | undefined>
): SQL {
	return withOrg(table, orgId, isNull(table.deletedAt), ...conditions);
}
