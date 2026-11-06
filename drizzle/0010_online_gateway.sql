ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_status";--> statement-breakpoint
ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_paid_verified";--> statement-breakpoint
DROP INDEX "online_orders_coupon_uq";--> statement-breakpoint
ALTER TABLE "online_orders" ALTER COLUMN "upi_vpa" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ALTER COLUMN "qr_payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "payment_method" text DEFAULT 'upi_manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_merchant_order_id" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_order_id" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_redirect_url" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_state" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_transaction_id" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_payment_mode" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_utr" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "gateway_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "refund_merchant_id" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "refund_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "refund_gateway_id" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "refund_state" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "refund_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "online_orders_coupon_uq" ON "online_orders" USING btree ("coupon_id") WHERE "online_orders"."coupon_id" is not null and "online_orders"."status" not in ('payment_failed','cancelled','expired','refunding','refunded');--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_gateway_merchant_order_id_unique" UNIQUE("gateway_merchant_order_id");--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_refund_merchant_id_unique" UNIQUE("refund_merchant_id");--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_method" CHECK ("online_orders"."payment_method" in ('upi_manual','razorpay'));--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_manual_qr" CHECK ("online_orders"."payment_method" <> 'upi_manual' or ("online_orders"."upi_vpa" is not null and "online_orders"."qr_payload" is not null));--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_status" CHECK ("online_orders"."status" in ('awaiting_payment','payment_submitted','paid','payment_failed','ready','collected','cancelled','expired','refunding','refunded'));--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_paid_verified" CHECK ("online_orders"."status" not in ('paid','ready','collected') or ("online_orders"."verified_at" is not null and ("online_orders"."utr" is not null or "online_orders"."gateway_transaction_id" is not null)));