DROP INDEX "storage_folders_org_parent_name_unique";--> statement-breakpoint
DROP INDEX "storage_folders_org_root_name_unique";--> statement-breakpoint
DROP INDEX "uploads_org_pending_expires_idx";--> statement-breakpoint
ALTER TABLE "storage_folders" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_folders" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_folders" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "storage_folders" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "storage_folders" ADD CONSTRAINT "storage_folders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_folders" ADD CONSTRAINT "storage_folders_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_folders_org_deleted_idx" ON "storage_folders" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE INDEX "uploads_org_deleted_idx" ON "uploads" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_folders_org_parent_name_unique" ON "storage_folders" USING btree ("organization_id","parent_id","name") WHERE "storage_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_folders_org_root_name_unique" ON "storage_folders" USING btree ("organization_id","name") WHERE "storage_folders"."parent_id" IS NULL AND "storage_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "uploads_org_pending_expires_idx" ON "uploads" USING btree ("organization_id","expires_at") WHERE "uploads"."status" = 'pending' AND "uploads"."deleted_at" IS NULL;