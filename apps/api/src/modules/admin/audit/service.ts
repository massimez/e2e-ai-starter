import { buildPaginationMeta } from "../shared";
import {
	type AuditLogListItem,
	type AuditRepository,
	drizzleAuditRepository,
} from "./repository";
import type { ExportAuditLogsQuery, ListAuditLogsQuery } from "./schema";

const CSV_FORMULA_PREFIX_REGEX = /^(?:[=+\-@\t\r\n]|\s+[=+\-@])/u;
const CSV_NEEDS_QUOTING_REGEX = /[",\n\r]/u;
const SAFE_FILENAME_SEGMENT_REGEX = /[^A-Za-z0-9_-]/gu;

const CSV_HEADERS = [
	"id",
	"createdAt",
	"organizationId",
	"organizationName",
	"action",
	"entityType",
	"entityId",
	"userId",
	"actorName",
	"actorEmail",
	"impersonatedBy",
	"ipAddress",
	"userAgent",
	"method",
	"path",
	"status",
	"durationMs",
	"requestId",
	"details",
] as const;

/**
 * Formats a single CSV cell per RFC 4180 with spreadsheet formula-injection neutralization.
 */
export function escapeCsvCell(value: unknown): string {
	let raw: string;
	if (value === null || value === undefined) {
		raw = "";
	} else if (value instanceof Date) {
		raw = value.toISOString();
	} else if (typeof value === "object") {
		raw = JSON.stringify(value);
	} else {
		raw = String(value);
	}

	const safe = CSV_FORMULA_PREFIX_REGEX.test(raw) ? `'${raw}` : raw;
	if (CSV_NEEDS_QUOTING_REGEX.test(safe)) {
		return `"${safe.replaceAll('"', '""')}"`;
	}
	return safe;
}

export function formatAuditLogsCsv(rows: readonly AuditLogListItem[]): string {
	const lines: string[] = [CSV_HEADERS.join(",")];

	for (const row of rows) {
		const details = row.details ?? {};
		const values: unknown[] = [
			row.id,
			row.createdAt,
			row.organizationId,
			row.organizationName,
			row.action,
			row.entityType,
			row.entityId,
			row.userId,
			row.actorName,
			row.actorEmail,
			details.impersonatedBy ?? "",
			row.ipAddress,
			row.userAgent,
			details.method ?? "",
			details.path ?? "",
			details.status ?? "",
			details.durationMs ?? "",
			details.requestId ?? "",
			details,
		];
		lines.push(values.map((cell) => escapeCsvCell(cell)).join(","));
	}

	return `${lines.join("\r\n")}\r\n`;
}

export function buildAuditExportFilename(
	scopeLabel: string,
	format: "csv" | "json",
	now = new Date()
): string {
	const safeLabel =
		scopeLabel.replace(SAFE_FILENAME_SEGMENT_REGEX, "_").slice(0, 48) ||
		"platform";
	const dateStamp = now.toISOString().slice(0, 10);
	return `audit-logs-${safeLabel}-${dateStamp}.${format}`;
}

export function createAuditService(
	repository: AuditRepository = drizzleAuditRepository
) {
	return {
		async exportAuditLogs(query: ExportAuditLogsQuery) {
			const { format, ...filterParams } = query;
			const rows = await repository.listAuditLogsForExport(filterParams);

			const scopeLabel =
				query.scope === "global"
					? "global"
					: (query.organizationId ?? "platform");
			const filename = buildAuditExportFilename(scopeLabel, format);

			if (format === "json") {
				return {
					contentType: "application/json; charset=utf-8",
					filename,
					payload: JSON.stringify(
						{
							exportedAt: new Date().toISOString(),
							organizationId: query.organizationId ?? null,
							rowCount: rows.length,
							rows,
							scope: query.scope,
						},
						null,
						2
					),
					rowCount: rows.length,
				};
			}

			return {
				contentType: "text/csv; charset=utf-8",
				filename,
				payload: formatAuditLogsCsv(rows),
				rowCount: rows.length,
			};
		},

		async listAuditLogs(query: ListAuditLogsQuery) {
			const { page, ...filterParams } = query;
			const offset = (page - 1) * query.limit;

			const { items, total } = await repository.listAuditLogs({
				...filterParams,
				offset,
			});

			return {
				items,
				pagination: buildPaginationMeta({
					itemCount: items.length,
					limit: query.limit,
					offset,
					page,
					total,
				}),
			};
		},
	};
}

export const auditService = createAuditService();
