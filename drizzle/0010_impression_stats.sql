CREATE TABLE "job_watermarks" (
	"name" varchar(64) PRIMARY KEY NOT NULL,
	"value" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_event_daily" (
	"day" date NOT NULL,
	"submission_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"impressions" integer NOT NULL,
	"completed_impressions" integer NOT NULL,
	"total_duration_ms" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "play_event_daily_day_submission_id_device_id_pk" PRIMARY KEY("day","submission_id","device_id")
);
--> statement-breakpoint
CREATE INDEX "play_event_daily_submission_day_idx" ON "play_event_daily" USING btree ("submission_id","day");--> statement-breakpoint
CREATE INDEX "play_events_started_idx" ON "play_events" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "play_events_received_idx" ON "play_events" USING btree ("received_at");