CREATE TABLE "shop_blocklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"reason" text NOT NULL,
	"account_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"remove_reason" text,
	CONSTRAINT "shop_blocklist_kind" CHECK ("shop_blocklist"."kind" in ('mobile','email'))
);
--> statement-breakpoint
CREATE TABLE "shop_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mobile" text NOT NULL,
	"email" text,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	"ip_hash" text,
	CONSTRAINT "shop_deletion_status" CHECK ("shop_deletion_requests"."status" in ('pending','completed','rejected','withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "status_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_blocklist" ADD CONSTRAINT "shop_blocklist_account_id_shop_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shop_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_blocklist" ADD CONSTRAINT "shop_blocklist_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_blocklist" ADD CONSTRAINT "shop_blocklist_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_deletion_requests" ADD CONSTRAINT "shop_deletion_requests_account_id_shop_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shop_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_deletion_requests" ADD CONSTRAINT "shop_deletion_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_blocklist_active_uq" ON "shop_blocklist" USING btree ("kind","value") WHERE "shop_blocklist"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_deletion_pending_uq" ON "shop_deletion_requests" USING btree ("account_id") WHERE "shop_deletion_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "shop_deletion_status_idx" ON "shop_deletion_requests" USING btree ("status","requested_at");--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD CONSTRAINT "shop_accounts_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Accounts staff had disabled become "frozen" (the same thing, now named).
UPDATE "shop_accounts" SET "status" = 'frozen' WHERE "is_active" = false;--> statement-breakpoint
-- The Admin role gets the new permission to ban, delete and block website customers.
INSERT INTO "role_permissions" ("role_id", "permission") SELECT "id", 'customers.ban' FROM "roles" WHERE "key" = 'admin' ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD CONSTRAINT "shop_accounts_status" CHECK ("shop_accounts"."status" in ('active','frozen','banned','deleted'));--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD CONSTRAINT "shop_accounts_active_status" CHECK ("shop_accounts"."is_active" = ("shop_accounts"."status" = 'active'));