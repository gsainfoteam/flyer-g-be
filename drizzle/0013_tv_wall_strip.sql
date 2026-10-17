-- 화면 전환 방식 개편: 예전 값 이름만 바꾼다. 기존 행도 함께 바뀐다 (FOUR_GRID → WALL, SINGLE → STRIP).
ALTER TYPE "public"."display_layout" RENAME VALUE 'FOUR_GRID' TO 'WALL';--> statement-breakpoint
ALTER TYPE "public"."display_layout" RENAME VALUE 'SINGLE' TO 'STRIP';--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "layout" SET DEFAULT 'WALL';--> statement-breakpoint
CREATE TYPE "public"."play_placement" AS ENUM('WALL', 'SPOTLIGHT', 'STRIP');--> statement-breakpoint
ALTER TABLE "play_event_daily" ADD COLUMN "wall_impressions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "play_events" ADD COLUMN "placement" "play_placement";
