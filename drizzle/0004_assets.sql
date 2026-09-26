CREATE TYPE "public"."asset_status" AS ENUM('PENDING_UPLOAD', 'READY', 'REJECTED');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" "asset_status" DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"declared_mime_type" varchar(50) NOT NULL,
	"declared_size_bytes" integer NOT NULL,
	"declared_checksum" varchar(71),
	"upload_expires_at" timestamp with time zone NOT NULL,
	"mime_type" varchar(50),
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"checksum" varchar(71),
	"rejection_reason" varchar(255),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_owner_id_idx" ON "assets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "assets_status_created_at_idx" ON "assets" USING btree ("status","created_at");