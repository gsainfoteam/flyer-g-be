CREATE TYPE "public"."asset_kind" AS ENUM('IMAGE', 'VIDEO');--> statement-breakpoint
ALTER TYPE "public"."asset_status" ADD VALUE 'PROCESSING';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "kind" "asset_kind" DEFAULT 'IMAGE' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "has_audio" boolean;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "processing_started_at" timestamp with time zone;