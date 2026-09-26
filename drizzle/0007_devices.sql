CREATE TYPE "public"."device_orientation" AS ENUM('LANDSCAPE', 'PORTRAIT');--> statement-breakpoint
CREATE TYPE "public"."display_layout" AS ENUM('SINGLE', 'FOUR_GRID');--> statement-breakpoint
CREATE TABLE "device_target_groups" (
	"device_id" uuid NOT NULL,
	"target_group_id" varchar(64) NOT NULL,
	CONSTRAINT "device_target_groups_device_id_target_group_id_pk" PRIMARY KEY("device_id","target_group_id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"location" varchar(200),
	"orientation" "device_orientation" DEFAULT 'LANDSCAPE' NOT NULL,
	"layout" "display_layout" DEFAULT 'FOUR_GRID' NOT NULL,
	"rotation_seconds" integer DEFAULT 10 NOT NULL,
	"refresh_after_seconds" integer DEFAULT 60 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_issued_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"app_version" varchar(32),
	"resolution_width" integer,
	"resolution_height" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "devices_rotation_seconds_range" CHECK ("devices"."rotation_seconds" between 5 and 60),
	CONSTRAINT "devices_refresh_after_seconds_range" CHECK ("devices"."refresh_after_seconds" between 15 and 300)
);
--> statement-breakpoint
ALTER TABLE "device_target_groups" ADD CONSTRAINT "device_target_groups_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_target_groups" ADD CONSTRAINT "device_target_groups_target_group_id_target_groups_id_fk" FOREIGN KEY ("target_group_id") REFERENCES "public"."target_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_target_groups_group_idx" ON "device_target_groups" USING btree ("target_group_id");