CREATE TYPE "public"."idempotency_status" AS ENUM('IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" varchar(64) NOT NULL,
	"key" varchar(255) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"status" "idempotency_status" NOT NULL,
	"response_body" jsonb,
	"locked_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");