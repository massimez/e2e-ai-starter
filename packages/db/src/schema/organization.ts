import { sql } from "drizzle-orm";
import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./organization-table";
import { user } from "./user";

export { organization } from "./organization-table";

export const member = pgTable(
	"member",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").default("member").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("member_organizationId_idx").on(table.organizationId),
		index("member_userId_idx").on(table.userId),
		uniqueIndex("member_org_user_unique").on(
			table.organizationId,
			table.userId
		),
	]
);

export const invitation = pgTable(
	"invitation",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		role: text("role").default("member").notNull(),
		status: text("status").default("pending").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		inviterId: text("inviter_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("invitation_organizationId_idx").on(table.organizationId),
		index("invitation_email_idx").on(table.email),
		index("invitation_inviterId_idx").on(table.inviterId),
		index("invitation_expiresAt_idx").on(table.expiresAt),
		uniqueIndex("invitation_org_email_pending_unique")
			.on(table.organizationId, table.email)
			.where(sql`${table.status} = 'pending'`),
	]
);

/**
 * Better Auth `organization` plugin `dynamicAccessControl` table for custom org roles.
 */
export const organizationRole = pgTable(
	"organization_role",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		permission: text("permission").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdateFn(() => new Date()),
	},
	(table) => [
		index("organization_role_organizationId_idx").on(table.organizationId),
		index("organization_role_role_idx").on(table.role),
		uniqueIndex("organization_role_org_role_unique").on(
			table.organizationId,
			table.role
		),
	]
);

export type Organization = typeof organization.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
export type OrganizationRole = typeof organizationRole.$inferSelect;
