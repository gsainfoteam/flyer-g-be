ALTER TYPE "public"."event_banner_occasion" ADD VALUE 'GRADUATION' BEFORE 'AWARD';--> statement-breakpoint
ALTER TABLE "submission_event_banners" ADD COLUMN "headline" varchar(30);