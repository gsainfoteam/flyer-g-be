CREATE TYPE "public"."submission_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ENDED', 'SUSPENDED', 'CANCELED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "submission_target_groups" (
	"submission_id" uuid NOT NULL,
	"target_group_id" varchar(64) NOT NULL,
	CONSTRAINT "submission_target_groups_submission_id_target_group_id_pk" PRIMARY KEY("submission_id","target_group_id")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"ziggle_notice_id" varchar(64),
	"title" varchar(200) NOT NULL,
	"category_id" varchar(64) NOT NULL,
	"asset_id" uuid NOT NULL,
	"detail_url" varchar(2048),
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "submission_status" NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"organizer_name" varchar(100),
	"subtitle" varchar(100),
	"location" varchar(100),
	"description" varchar(1000),
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "submissions_period_order" CHECK ("submissions"."end_at" > "submissions"."start_at")
);
--> statement-breakpoint
ALTER TABLE "submission_target_groups" ADD CONSTRAINT "submission_target_groups_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_target_groups" ADD CONSTRAINT "submission_target_groups_target_group_id_target_groups_id_fk" FOREIGN KEY ("target_group_id") REFERENCES "public"."target_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submissions_requester_created_idx" ON "submissions" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE INDEX "submissions_status_submitted_idx" ON "submissions" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "submissions_created_idx" ON "submissions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_ziggle_notice_id_active_uq" ON "submissions" USING btree ("ziggle_notice_id") WHERE "submissions"."status" <> 'CANCELED';