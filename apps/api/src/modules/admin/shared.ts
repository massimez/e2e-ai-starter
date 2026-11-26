import { user } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Matches Better Auth `user.role` entries containing the platform `"admin"` role
 * (single value or comma-separated list), mirroring `isPlatformAdminRole`.
 */
export const PLATFORM_ADMIN_ROLE_SQL = sql`coalesce(${user.role}, '') ~* '(^|,)\\s*admin\\s*(,|$)'`;

/**
 * Matches users whose ban is currently active (permanent or not yet expired).
 */
export const ACTIVE_USER_BAN_SQL = sql`(${user.banned} = true AND (${user.banExpires} IS NULL OR ${user.banExpires} > now()))`;

/**
 * Constant PostgreSQL advisory transaction lock key serializing platform admin
 * role promotion/demotion and ban mutations to prevent last-admin or ban-vs-promote races.
 */
export const ADMIN_MUTATION_ADVISORY_LOCK_KEY = 2_026_027_001;

/**
 * Optional query-string field that trims whitespace and normalizes empty strings to `undefined`.
 */
export function optionalTrimmed(maxLength: number) {
	return z
		.string()
		.trim()
		.max(maxLength)
		.optional()
		.transform((value) => (value && value.length > 0 ? value : undefined));
}

export const adminPaginationFields = {
	limit: z.coerce.number().int().min(1).max(100).default(25),
	page: z.coerce.number().int().min(1).max(10_000).default(1),
};

export interface AdminPaginationMeta {
	hasMore: boolean;
	limit: number;
	page: number;
	total: number;
	totalPages: number;
}

export function buildPaginationMeta(params: {
	itemCount: number;
	limit: number;
	offset: number;
	page: number;
	total: number;
}): AdminPaginationMeta {
	return {
		hasMore: params.offset + params.itemCount < params.total,
		limit: params.limit,
		page: params.page,
		total: params.total,
		totalPages: Math.max(1, Math.ceil(params.total / params.limit)),
	};
}

export function toCountMap<T extends { total: number | string }>(
	rows: readonly T[],
	getKey: (row: T) => string
): Map<string, number> {
	const result = new Map<string, number>();
	for (const row of rows) {
		result.set(getKey(row), Number(row.total));
	}
	return result;
}
