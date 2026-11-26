import { db } from "@workspace/db";
import {
	type AuditLogDetails,
	auditLog,
	escapeLikePattern,
	organization,
	user,
} from "@workspace/db/schema";
import {
	and,
	count,
	desc,
	eq,
	gte,
	ilike,
	isNotNull,
	isNull,
	lte,
	or,
	type SQL,
} from "drizzle-orm";
import { parseAuditFilterDate } from "./schema";

export interface AuditLogFilterParams {
	action?: string;
	entityType?: string;
	from?: string;
	organizationId?: string;
	scope?: "all" | "global" | "organization";
	search?: string;
	to?: string;
	userId?: string;
}

export interface AuditLogListItem {
	action: string;
	actorEmail: string | null;
	actorName: string | null;
	createdAt: Date;
	details: AuditLogDetails | null;
	entityId: string | null;
	entityType: string | null;
	id: string;
	ipAddress: string | null;
	organizationId: string | null;
	organizationName: string | null;
	organizationSlug: string | null;
	userAgent: string | null;
	userId: string | null;
}

function buildAuditWhereClause(params: AuditLogFilterParams): SQL | undefined {
	const conditions: Array<SQL | undefined> = [];

	if (params.scope === "global") {
		conditions.push(isNull(auditLog.organizationId));
	} else if (params.organizationId) {
		conditions.push(eq(auditLog.organizationId, params.organizationId));
	} else if (params.scope === "organization") {
		conditions.push(isNotNull(auditLog.organizationId));
	}

	if (params.action) {
		conditions.push(
			ilike(auditLog.action, `${escapeLikePattern(params.action)}%`)
		);
	}
	if (params.entityType) {
		conditions.push(eq(auditLog.entityType, params.entityType));
	}
	if (params.userId) {
		conditions.push(eq(auditLog.userId, params.userId));
	}

	const fromDate = parseAuditFilterDate(params.from, "start");
	if (fromDate) {
		conditions.push(gte(auditLog.createdAt, fromDate));
	}

	const toDate = parseAuditFilterDate(params.to, "end");
	if (toDate) {
		conditions.push(lte(auditLog.createdAt, toDate));
	}

	if (params.search) {
		const pattern = `%${escapeLikePattern(params.search)}%`;
		conditions.push(
			or(
				ilike(auditLog.action, pattern),
				ilike(auditLog.entityType, pattern),
				ilike(auditLog.entityId, pattern),
				ilike(auditLog.ipAddress, pattern),
				ilike(auditLog.organizationId, pattern),
				ilike(organization.name, pattern),
				ilike(organization.slug, pattern),
				ilike(user.email, pattern),
				ilike(user.name, pattern)
			)
		);
	}

	const defined = conditions.filter((item): item is SQL => item !== undefined);
	return defined.length > 0 ? and(...defined) : undefined;
}

const auditSelectFields = {
	action: auditLog.action,
	actorEmail: user.email,
	actorName: user.name,
	createdAt: auditLog.createdAt,
	details: auditLog.details,
	entityId: auditLog.entityId,
	entityType: auditLog.entityType,
	id: auditLog.id,
	ipAddress: auditLog.ipAddress,
	organizationId: auditLog.organizationId,
	organizationName: organization.name,
	organizationSlug: organization.slug,
	userAgent: auditLog.userAgent,
	userId: auditLog.userId,
};

/**
 * Builds the Drizzle-backed repository for platform backoffice audit log queries.
 * Intentionally cross-tenant and guarded exclusively by `platformAdminMiddleware`.
 */
export function createDrizzleAuditRepository(database = db) {
	function queryRows(
		whereClause: SQL | undefined,
		limit: number,
		offset = 0
	): Promise<AuditLogListItem[]> {
		return database
			.select(auditSelectFields)
			.from(auditLog)
			.leftJoin(user, eq(auditLog.userId, user.id))
			.leftJoin(organization, eq(auditLog.organizationId, organization.id))
			.where(whereClause)
			.orderBy(desc(auditLog.createdAt), desc(auditLog.id))
			.limit(limit)
			.offset(offset);
	}

	function queryTotalCount(
		whereClause: SQL | undefined,
		needsSearchJoins: boolean
	) {
		if (needsSearchJoins) {
			return database
				.select({ total: count() })
				.from(auditLog)
				.leftJoin(user, eq(auditLog.userId, user.id))
				.leftJoin(organization, eq(auditLog.organizationId, organization.id))
				.where(whereClause);
		}
		return database
			.select({ total: count() })
			.from(auditLog)
			.where(whereClause);
	}

	return {
		async listAuditLogs(
			params: AuditLogFilterParams & { limit: number; offset: number }
		): Promise<{ items: AuditLogListItem[]; total: number }> {
			const whereClause = buildAuditWhereClause(params);

			const [items, totalRows] = await Promise.all([
				queryRows(whereClause, params.limit, params.offset),
				queryTotalCount(whereClause, Boolean(params.search)),
			]);

			return {
				items,
				total: totalRows[0]?.total ?? 0,
			};
		},

		async listAuditLogsForExport(
			params: AuditLogFilterParams & { limit: number }
		): Promise<AuditLogListItem[]> {
			return await queryRows(buildAuditWhereClause(params), params.limit);
		},

		async listRecentAuditLogs(limit: number): Promise<AuditLogListItem[]> {
			return await queryRows(undefined, limit, 0);
		},
	};
}

export type AuditRepository = ReturnType<typeof createDrizzleAuditRepository>;

export const drizzleAuditRepository = createDrizzleAuditRepository();
