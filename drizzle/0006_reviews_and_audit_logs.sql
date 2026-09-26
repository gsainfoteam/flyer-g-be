CREATE TYPE "public"."audit_actor_type" AS ENUM('USER', 'DEVICE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."reject_reason_code" AS ENUM('LOW_RESOLUTION', 'ASPECT_RATIO', 'INFO_MISMATCH', 'INAPPROPRIATE', 'PERIOD', 'DUPLICATE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" varchar(64),
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" varchar(64) NOT NULL,
	"reason" varchar(1000),
	"metadata" jsonb,
	"request_id" varchar(128),
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"decision" "review_decision" NOT NULL,
	"reason_code" "reject_reason_code",
	"comment" varchar(1000),
	"reviewer_id" uuid NOT NULL,
	"asset_checksum" varchar(71),
	"reviewed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reviews_submission_reviewed_idx" ON "reviews" USING btree ("submission_id","reviewed_at");