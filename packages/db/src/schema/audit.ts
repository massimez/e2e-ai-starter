import { sql } from "drizzle-orm";
import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./user";

export interface AuditLogDetails {
	durationMs?: number;
	method?: string;
	path?: string;
	reason?: string;
	requestId?: string;
	status?: number;
	[key: string]: unknown;
}

export const auditLog = pgTable(
	"audit_log",
	{
		id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		organizationId: text("organization_id"),
		action: varchar("action", { length: 120 }).notNull(),
		entityType: varchar("entity_type", { length: 80 }),
		entityId: text("entity_id"),
		details: jsonb("details").$type<AuditLogDetails>(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("audit_log_created_idx").on(table.createdAt),
		index("audit_log_org_created_idx").on(
			table.organizationId,
			table.createdAt
		),
		index("audit_log_user_created_idx").on(table.userId, table.createdAt),
	]
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
