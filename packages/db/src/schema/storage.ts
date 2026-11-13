import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { user } from "./user";

export type UploadStatus = "pending" | "committed" | "failed";
export type UploadMetadata = Record<string, unknown>;

export const organizationStorageLimits = pgTable(
	"organization_storage_limits",
	{
		currentUsage: bigint("current_usage", { mode: "number" })
			.default(0)
			.notNull(),
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		storageLimit: bigint("storage_limit", { mode: "number" })
			.default(1_073_741_824) // 1GB default
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdateFn(() => new Date())
			.notNull(),
	},
	(table) => [
		check(
			"org_storage_limits_non_negative_check",
			sql`${table.currentUsage} >= 0 AND ${table.storageLimit} >= 0`
		),
	]
);

export const storageFolders = pgTable(
	"storage_folders",
	{
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
		name: varchar("name", { length: 255 }).notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, {
				onDelete: "cascade",
			}),
		parentId: uuid("parent_id"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdateFn(() => new Date())
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
		}).onDelete("cascade"),
		index("storage_folders_org_parent_idx").on(
			table.organizationId,
			table.parentId
		),
		index("storage_folders_parent_idx").on(table.parentId),
		uniqueIndex("storage_folders_org_parent_name_unique").on(
			table.organizationId,
			table.parentId,
			table.name
		),
	]
);

export const uploads = pgTable(
	"uploads",
	{
		bucket: varchar("bucket", { length: 100 }).notNull(),
		contentType: varchar("content_type", { length: 100 }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		fileKey: text("file_key").notNull(),
		folderId: uuid("folder_id").references(() => storageFolders.id, {
			onDelete: "set null",
		}),
		id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
		metadata: jsonb("metadata").$type<UploadMetadata>(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, {
				onDelete: "cascade",
			}),
		size: bigint("size", { mode: "number" }),
		status: varchar("status", { length: 20 })
			.$type<UploadStatus>()
			.default("pending")
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdateFn(() => new Date())
			.notNull(),
		userId: text("user_id").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("uploads_org_folder_idx").on(table.organizationId, table.folderId),
		index("uploads_folder_idx").on(table.folderId),
		index("uploads_user_idx").on(table.userId),
		index("uploads_expires_at_idx").on(table.expiresAt),
		index("uploads_org_status_created_idx").on(
			table.organizationId,
			table.status,
			table.createdAt
		),
		uniqueIndex("uploads_file_key_unique").on(table.fileKey),
		check(
			"uploads_size_non_negative_check",
			sql`${table.size} IS NULL OR ${table.size} >= 0`
		),
		check(
			"uploads_status_check",
			sql`${table.status} IN ('pending', 'committed', 'failed')`
		),
	]
);

export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;
export type StorageFolder = typeof storageFolders.$inferSelect;
export type OrganizationStorageLimit =
	typeof organizationStorageLimits.$inferSelect;
