CREATE TABLE "shop_otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"email" text NOT NULL,
	"account_id" uuid,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_accounts" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_otp_challenges" ADD CONSTRAINT "shop_otp_challenges_account_id_shop_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shop_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_otp_email_idx" ON "shop_otp_challenges" USING btree ("email","purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_accounts_email_verified_uq" ON "shop_accounts" USING btree (lower("email")) WHERE "shop_accounts"."email_verified_at" is not null;