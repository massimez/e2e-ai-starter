import { text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../user";

const SQL_LIKE_SPECIAL_CHARS_REGEX = /[\\%_]/gu;

/**
 * Escapes PostgreSQL `LIKE` / `ILIKE` wildcard metacharacters (`\`, `%`, `_`).
 */
export function escapeLikePattern(value: string): string {
	return value.replace(SQL_LIKE_SPECIAL_CHARS_REGEX, "\\$&");
}

// Soft-delete & audit trail mixin (spread into tables)
export const softAudit = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdateFn(() => new Date()),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	createdBy: text("created_by").references(() => user.id, {
		onDelete: "set null",
	}),
	updatedBy: text("updated_by").references(() => user.id, {
		onDelete: "set null",
	}),
};
