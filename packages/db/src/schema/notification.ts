import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { user } from "./user";

export const NOTIFICATION_CATEGORIES = [
	"system",
	"security",
	"team",
	"project",
	"billing",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationMetadata = Record<string, unknown>;

export const notification = pgTable(
	"notification",
	{
		category: text("category")
			.$type<NotificationCategory>()
			.default("system")
			.notNull(),
		content: text("content").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		data: jsonb("data").$type<NotificationMetadata>(),
		id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
		idempotencyKey: text("idempotency_key"),
		isRead: boolean("is_read").default(false).notNull(),
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),
		readAt: timestamp("read_at", { withTimezone: true }),
		title: text("title").notNull(),
		type: text("type").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("notification_user_created_idx").on(table.userId, table.createdAt),
		index("notification_user_unread_idx").on(
			table.userId,
			table.isRead,
			table.createdAt
		),
		index("notification_org_idx").on(table.organizationId),
		index("notification_read_at_idx").on(table.readAt),
		index("notification_created_idx").on(table.createdAt),
		uniqueIndex("notification_user_idempotency_unique").on(
			table.userId,
			table.idempotencyKey
		),
		check(
			"notification_category_check",
			sql`${table.category} IN ('system', 'security', 'team', 'project', 'billing')`
		),
	]
);

export const notificationPreference = pgTable(
	"notification_preference",
	{
		category: text("category").$type<NotificationCategory>().notNull(),
		channel: text("channel").$type<NotificationChannel>().notNull(),
		enabled: boolean("enabled").default(true).notNull(),
		id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdateFn(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("notification_preference_user_category_channel_idx").on(
			table.userId,
			table.category,
			table.channel
		),
		check(
			"notification_preference_category_check",
			sql`${table.category} IN ('system', 'security', 'team', 'project', 'billing')`
		),
		check(
			"notification_preference_channel_check",
			sql`${table.channel} IN ('in_app', 'email', 'push')`
		),
	]
);

export const pushSubscription = pgTable(
	"push_subscription",
	{
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		endpoint: text("endpoint").notNull(),
		id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
		keys: jsonb("keys").$type<{ auth: string; p256dh: string }>().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdateFn(() => new Date())
			.notNull(),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("push_subscription_user_endpoint_idx").on(
			table.userId,
			table.endpoint
		),
	]
);

export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;
export type NotificationPreference = typeof notificationPreference.$inferSelect;
export type PushSubscription = typeof pushSubscription.$inferSelect;
