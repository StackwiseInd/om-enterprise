ALTER TABLE "online_orders" DROP COLUMN IF EXISTS "gateway_redirect_url";--> statement-breakpoint
ALTER TABLE "online_orders" DROP CONSTRAINT IF EXISTS "online_orders_method";--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_method" CHECK ("online_orders"."payment_method" in ('upi_manual','razorpay'));
