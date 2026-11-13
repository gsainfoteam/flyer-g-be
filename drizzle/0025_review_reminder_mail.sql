CREATE TABLE "mail_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" varchar(320) NOT NULL,
	"recipient" varchar(254) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"text" varchar(4000) NOT NULL,
	"html" varchar(16000) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"claim_token" uuid,
	"last_error" varchar(128),
	"message_id" varchar(255),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE INDEX "mail_notifications_pending_idx" ON "mail_notifications" USING btree ("status","available_at");