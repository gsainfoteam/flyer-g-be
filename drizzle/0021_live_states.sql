-- 라이브 상태. 범위(기기·그룹)마다 하나. until이 지난 것은 읽을 때 뺀다.
CREATE TYPE "public"."live_scope" AS ENUM('DEVICE', 'GROUP');--> statement-breakpoint
CREATE TABLE "live_states" (
	"scope" "live_scope" NOT NULL,
	"scope_id" varchar(64) NOT NULL,
	"main" jsonb,
	"alert" jsonb,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "live_states_scope_scope_id_pk" PRIMARY KEY("scope","scope_id")
);
--> statement-breakpoint
ALTER TABLE "live_states" ADD CONSTRAINT "live_states_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;