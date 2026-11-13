import {
	type AnyPgColumn,
	boolean,
	index,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "./organization-table";

export const user = pgTable(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull().unique(),
		emailVerified: boolean("email_verified")
			.$defaultFn(() => false)
			.notNull(),
		image: text("image"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdateFn(() => new Date())
			.notNull(),
		role: text("role").default("user"),
		banned: boolean("banned").default(false),
		banReason: text("ban_reason"),
		banExpires: timestamp("ban_expires"),
		phoneNumber: text("phone_number").unique(),
		phoneNumberVerified: boolean("phone_number_verified").default(false),
		firstName: text("first_name"),
		lastName: text("last_name"),
		locale: text("locale").default("en").notNull(),
		defaultOrganizationId: text("default_organization_id").references(
			(): AnyPgColumn => organization.id,
			{ onDelete: "set null" }
		),
	},
	(table) => [
		index("user_default_organization_idx").on(table.defaultOrganizationId),
	]
);

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
