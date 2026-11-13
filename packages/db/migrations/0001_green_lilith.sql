DROP INDEX "organization_slug_idx";--> statement-breakpoint
DROP INDEX "uploads_file_key_idx";--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_folders" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "size" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "category" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_org_idx" ON "notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_read_at_idx" ON "notification" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notification" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_user_idempotency_unique" ON "notification" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "invitation_inviterId_idx" ON "invitation" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "invitation_expiresAt_idx" ON "invitation" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_unique" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "storage_folders_parent_idx" ON "storage_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_folders_org_parent_name_unique" ON "storage_folders" USING btree ("organization_id","parent_id","name");--> statement-breakpoint
CREATE INDEX "uploads_folder_idx" ON "uploads" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "uploads_expires_at_idx" ON "uploads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "uploads_org_status_created_idx" ON "uploads" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_file_key_unique" ON "uploads" USING btree ("file_key");--> statement-breakpoint
CREATE INDEX "account_provider_account_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "session_activeOrganizationId_idx" ON "session" USING btree ("active_organization_id");--> statement-breakpoint
CREATE INDEX "session_expiresAt_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verification_expiresAt_idx" ON "verification" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_category_check" CHECK ("notification"."category" IN ('system', 'security', 'team', 'project', 'billing'));--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_category_check" CHECK ("notification_preference"."category" IN ('system', 'security', 'team', 'project', 'billing'));--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_channel_check" CHECK ("notification_preference"."channel" IN ('in_app', 'email', 'push'));--> statement-breakpoint
ALTER TABLE "organization_storage_limits" ADD CONSTRAINT "org_storage_limits_non_negative_check" CHECK ("organization_storage_limits"."current_usage" >= 0 AND "organization_storage_limits"."storage_limit" >= 0);--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_size_non_negative_check" CHECK ("uploads"."size" IS NULL OR "uploads"."size" >= 0);--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_status_check" CHECK ("uploads"."status" IN ('pending', 'committed', 'failed'));