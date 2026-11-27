import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./organization-table";
import { user } from "./user";

export const workspaceWallet = pgTable(
	"workspace_wallet",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		balance: integer("balance").default(0).notNull(),
	},
	(table) => [
		check("workspace_wallet_balance_check", sql`${table.balance} >= 0`),
	]
);

export const walletEntry = pgTable(
	"wallet_entry",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => workspaceWallet.organizationId, {
				onDelete: "cascade",
			}),
		operationKey: text("operation_key").notNull(),
		kind: text("kind", {
			enum: ["grant", "workspace_brief", "reversal"],
		}).notNull(),
		delta: integer("delta").notNull(),
		actorId: text("actor_id").references(() => user.id, {
			onDelete: "set null",
		}),
		reason: text("reason"),
		requestId: text("request_id"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("wallet_entry_org_operation_unique").on(
			table.organizationId,
			table.operationKey
		),
		index("wallet_entry_org_created_idx").on(
			table.organizationId,
			table.createdAt.desc(),
			table.id.desc()
		),
		index("wallet_entry_actor_idx").on(table.actorId),
		uniqueIndex("wallet_entry_org_request_unique")
			.on(table.organizationId, table.requestId)
			.where(sql`${table.requestId} is not null`),
		check(
			"wallet_entry_delta_check",
			sql`(${table.kind} in ('grant', 'reversal') and ${table.delta} > 0)
				or (${table.kind} = 'workspace_brief' and ${table.delta} < 0)`
		),
	]
);
