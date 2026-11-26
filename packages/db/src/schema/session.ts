import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { user } from "./user";

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at").notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdateFn(() => new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		impersonatedBy: text("impersonated_by"),
		activeOrganizationId: text("active_organization_id").references(
			() => organization.id,
			{ onDelete: "set null" }
		),
	},
	(table) => [
		index("session_userId_idx").on(table.userId),
		index("session_activeOrganizationId_idx").on(table.activeOrganizationId),
		index("session_expiresAt_idx").on(table.expiresAt),
	]
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at"),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdateFn(() => new Date())
			.notNull(),
	},
	(table) => [
		index("account_userId_idx").on(table.userId),
		index("account_provider_account_idx").on(table.providerId, table.accountId),
	]
);

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdateFn(() => new Date())
			.notNull(),
	},
	(table) => [
		index("verification_identifier_idx").on(table.identifier),
		index("verification_expiresAt_idx").on(table.expiresAt),
	]
);

export const twoFactor = pgTable(
	"two_factor",
	{
		id: text("id").primaryKey(),
		secret: text("secret").notNull(),
		backupCodes: text("backup_codes").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		verified: boolean("verified").default(true),
		failedVerificationCount: integer("failed_verification_count").default(0),
		lockedUntil: timestamp("locked_until"),
	},
	(table) => [
		index("twoFactor_userId_idx").on(table.userId),
		index("twoFactor_secret_idx").on(table.secret),
	]
);

export type Session = typeof session.$inferSelect;
export type TwoFactor = typeof twoFactor.$inferSelect;
