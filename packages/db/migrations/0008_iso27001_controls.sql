CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF OLD.user_id IS NOT NULL
			AND NEW.user_id IS NULL
			AND NEW.id IS NOT DISTINCT FROM OLD.id
			AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
			AND NEW.action IS NOT DISTINCT FROM OLD.action
			AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type
			AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
			AND NEW.details IS NOT DISTINCT FROM OLD.details
			AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
			AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
			AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
		THEN
			RETURN NEW;
		END IF;
		RAISE EXCEPTION 'audit_log is append-only and cannot be updated' USING ERRCODE = '55000';
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF coalesce(current_setting('app.audit_retention_prune', true), '') = 'on' THEN
			RETURN OLD;
		END IF;
		RAISE EXCEPTION 'audit_log rows cannot be deleted outside retention pruning' USING ERRCODE = '55000';
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_immutability_trigger ON "audit_log";--> statement-breakpoint
CREATE TRIGGER audit_log_immutability_trigger
BEFORE UPDATE OR DELETE ON "audit_log"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_mutation();
