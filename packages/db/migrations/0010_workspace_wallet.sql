CREATE TABLE "wallet_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	"actor_id" text,
	"reason" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_entry_org_operation_unique" UNIQUE("organization_id","operation_key"),
	CONSTRAINT "wallet_entry_delta_check" CHECK (("wallet_entry"."kind" in ('grant', 'reversal') and "wallet_entry"."delta" > 0)
				or ("wallet_entry"."kind" = 'workspace_brief' and "wallet_entry"."delta" < 0))
);
--> statement-breakpoint
CREATE TABLE "workspace_wallet" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workspace_wallet_balance_check" CHECK ("workspace_wallet"."balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "wallet_entry" ADD CONSTRAINT "wallet_entry_organization_id_workspace_wallet_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."workspace_wallet"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entry" ADD CONSTRAINT "wallet_entry_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_wallet" ADD CONSTRAINT "workspace_wallet_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_entry_org_created_idx" ON "wallet_entry" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wallet_entry_actor_idx" ON "wallet_entry" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_entry_org_request_unique" ON "wallet_entry" USING btree ("organization_id","request_id") WHERE "wallet_entry"."request_id" is not null;