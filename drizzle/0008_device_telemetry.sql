CREATE TABLE "play_events" (
	"device_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"submission_id" uuid NOT NULL,
	"revision" integer,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"completed" boolean NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "play_events_device_id_event_id_pk" PRIMARY KEY("device_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_playlist_version" varchar(64);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_render_ok_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "play_events" ADD CONSTRAINT "play_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "play_events_submission_started_idx" ON "play_events" USING btree ("submission_id","started_at");