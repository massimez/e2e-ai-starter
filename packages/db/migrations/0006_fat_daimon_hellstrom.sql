ALTER TABLE "organization_role_permission" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "organization_role_permission" CASCADE;--> statement-breakpoint
DELETE FROM "organization_role";--> statement-breakpoint
DROP INDEX "organization_role_org_slug_unique";--> statement-breakpoint
DROP INDEX "organization_role_org_default_unique";--> statement-breakpoint
DROP INDEX "organization_role_org_idx";--> statement-breakpoint
ALTER TABLE "organization_role" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "organization_role" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization_role" ALTER COLUMN "created_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "organization_role" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "organization_role" ALTER COLUMN "updated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "organization_role" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "organization_role" ALTER COLUMN "updated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_role" ADD COLUMN "role" text NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_role" ADD COLUMN "permission" text NOT NULL;--> statement-breakpoint
CREATE INDEX "organization_role_organizationId_idx" ON "organization_role" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_role_role_idx" ON "organization_role" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_role_org_role_unique" ON "organization_role" USING btree ("organization_id","role");--> statement-breakpoint
ALTER TABLE "organization_role" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "organization_role" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "organization_role" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "organization_role" DROP COLUMN "is_system";--> statement-breakpoint
ALTER TABLE "organization_role" DROP COLUMN "is_default";