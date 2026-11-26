import { z } from "zod";
import { adminPaginationFields, optionalTrimmed } from "../shared";

const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/u;

const optionalDateString = z
	.string()
	.trim()
	.optional()
	.transform((value) => (value && value.length > 0 ? value : undefined))
	.refine(
		(value) => (value ? !Number.isNaN(Date.parse(value)) : true),
		"Must be a valid ISO date or datetime string"
	);

const auditLogFilterFields = {
	action: optionalTrimmed(120),
	entityType: optionalTrimmed(80),
	from: optionalDateString,
	organizationId: optionalTrimmed(128),
	scope: z.enum(["all", "global", "organization"]).default("all"),
	search: optionalTrimmed(120),
	to: optionalDateString,
	userId: optionalTrimmed(128),
};

function hasValidDateRange(value: { from?: string; to?: string }): boolean {
	const fromDate = parseAuditFilterDate(value.from, "start");
	const toDate = parseAuditFilterDate(value.to, "end");
	if (fromDate && toDate) {
		return fromDate.getTime() <= toDate.getTime();
	}
	return true;
}

export const listAuditLogsQuerySchema = z
	.object({
		...auditLogFilterFields,
		...adminPaginationFields,
	})
	.refine(hasValidDateRange, {
		message: "'from' date must be earlier than or equal to 'to' date",
		path: ["from"],
	});

export const exportAuditLogsQuerySchema = z
	.object({
		...auditLogFilterFields,
		format: z.enum(["csv", "json"]).default("csv"),
		limit: z.coerce.number().int().min(1).max(5000).default(1000),
	})
	.refine(hasValidDateRange, {
		message: "'from' date must be earlier than or equal to 'to' date",
		path: ["from"],
	});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
export type ExportAuditLogsQuery = z.infer<typeof exportAuditLogsQuerySchema>;

export function parseAuditFilterDate(
	raw: string | undefined,
	boundary: "start" | "end"
): Date | undefined {
	if (!raw) {
		return undefined;
	}
	if (boundary === "end" && ISO_DATE_ONLY_REGEX.test(raw)) {
		return new Date(`${raw}T23:59:59.999Z`);
	}
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
