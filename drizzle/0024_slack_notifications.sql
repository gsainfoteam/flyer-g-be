CREATE TABLE "device_alert_states" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(16) NOT NULL,
	"observed_last_seen_at" timestamp with time zone,
	"grace_until" timestamp with time zone NOT NULL,
	"incident_id" uuid,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_delivery_state" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"claim_token" uuid,
	"locked_until" timestamp with time zone NOT NULL,
	"next_send_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" varchar(160) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"device_id" uuid,
	"incident_id" uuid,
	"text" varchar(3000) NOT NULL,
	"presentation" jsonb,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claim_token" uuid,
	"last_error" varchar(128),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "slack_notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "device_alert_states" ADD CONSTRAINT "device_alert_states_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_notifications" ADD CONSTRAINT "slack_notifications_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_notifications_pending_idx" ON "slack_notifications" USING btree ("status","available_at");