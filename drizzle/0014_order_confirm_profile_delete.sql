ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_status";--> statement-breakpoint
ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_paid_verified";--> statement-breakpoint
DROP INDEX "online_orders_utr_uq";--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "customer_email" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "customer_details" jsonb;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "business_name" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "alt_mobile" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "landmark" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "pincode" text;--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "profile_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "online_orders_utr_uq" ON "online_orders" USING btree (upper("utr")) WHERE "online_orders"."utr" is not null and "online_orders"."status" in ('payment_submitted','paid','confirmed','ready','collected');--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_status" CHECK ("online_orders"."status" in ('awaiting_payment','payment_submitted','paid','payment_failed','confirmed','ready','collected','cancelled','expired','refunding','refunded'));--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_paid_verified" CHECK ("online_orders"."status" not in ('paid','confirmed','ready','collected') or ("online_orders"."verified_at" is not null and ("online_orders"."utr" is not null or "online_orders"."gateway_transaction_id" is not null)));