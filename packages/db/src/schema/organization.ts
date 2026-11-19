import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./helpers/common";
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

export const organizationRole = pgTable(
	"organization_role",
	{
		id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		slug: varchar("slug", { length: 80 }).notNull(),
		name: varchar("name", { length: 120 }).notNull(),
		description: text("description"),
		isSystem: boolean("is_system").default(false).notNull(),
		isDefault: boolean("is_default").default(false).notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex("organization_role_org_slug_unique").on(
			table.organizationId,
			table.slug
		),
		uniqueIndex("organization_role_org_default_unique")
			.on(table.organizationId)
			.where(sql`${table.isDefault} = true`),
		index("organization_role_org_idx").on(table.organizationId),
	]
);

export const organizationRolePermission = pgTable(
	"organization_role_permission",
	{
		id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
		roleId: uuid("role_id")
			.notNull()
			.references(() => organizationRole.id, { onDelete: "cascade" }),
		resource: varchar("resource", { length: 80 }).notNull(),
		action: varchar("action", { length: 80 }).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("organization_role_permission_unique").on(
			table.roleId,
			table.resource,
			table.action
		),
		index("organization_role_permission_role_idx").on(table.roleId),
	]
);

export type Organization = typeof organization.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
export type OrganizationRole = typeof organizationRole.$inferSelect;
export type OrganizationRolePermission =
	typeof organizationRolePermission.$inferSelect;
