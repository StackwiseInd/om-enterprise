CREATE TABLE "coupon_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"amount_off" numeric(14, 2) NOT NULL,
	"min_order" numeric(14, 2) DEFAULT '0' NOT NULL,
	"valid_until" timestamp with time zone,
	"code_count" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_batches_amount" CHECK ("coupon_batches"."amount_off" > 0 and "coupon_batches"."min_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"order_id" uuid,
	"used_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"disabled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code"),
	CONSTRAINT "coupons_status" CHECK ("coupons"."status" in ('active','reserved','used','disabled')),
	CONSTRAINT "coupons_order_when_taken" CHECK ("coupons"."status" not in ('reserved','used') or "coupons"."order_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "online_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"variant_name" text,
	"sku" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"account_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"mobile" text NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"coupon_id" uuid,
	"coupon_code" text,
	"upi_vpa" text NOT NULL,
	"qr_payload" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"utr" text,
	"utr_submitted_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"failure_reason" text,
	"ready_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"handled_by" uuid,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "online_orders_status" CHECK ("online_orders"."status" in ('awaiting_payment','payment_submitted','paid','payment_failed','ready','collected','cancelled','expired')),
	CONSTRAINT "online_orders_amounts" CHECK ("online_orders"."discount" >= 0 and "online_orders"."total" > 0 and "online_orders"."total" = "online_orders"."subtotal" - "online_orders"."discount"),
	CONSTRAINT "online_orders_paid_verified" CHECK ("online_orders"."status" not in ('paid','ready','collected') or ("online_orders"."verified_at" is not null and "online_orders"."utr" is not null))
);
--> statement-breakpoint
CREATE TABLE "shop_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mobile" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_accounts_mobile_unique" UNIQUE("mobile")
);
--> statement-breakpoint
CREATE TABLE "shop_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coupon_batches" ADD CONSTRAINT "coupon_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_batch_id_coupon_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."coupon_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_order_lines" ADD CONSTRAINT "online_order_lines_order_id_online_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."online_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_order_lines" ADD CONSTRAINT "online_order_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_account_id_shop_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shop_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_sessions" ADD CONSTRAINT "shop_sessions_account_id_shop_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shop_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupons_batch_idx" ON "coupons" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "online_order_lines_order_idx" ON "online_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "online_orders_status_idx" ON "online_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "online_orders_account_idx" ON "online_orders" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "online_orders_utr_uq" ON "online_orders" USING btree (upper("utr")) WHERE "online_orders"."utr" is not null and "online_orders"."status" in ('payment_submitted','paid','ready','collected');--> statement-breakpoint
CREATE UNIQUE INDEX "online_orders_coupon_uq" ON "online_orders" USING btree ("coupon_id") WHERE "online_orders"."coupon_id" is not null and "online_orders"."status" not in ('payment_failed','cancelled','expired');--> statement-breakpoint
CREATE INDEX "shop_sessions_account_idx" ON "shop_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "online_order_seq";