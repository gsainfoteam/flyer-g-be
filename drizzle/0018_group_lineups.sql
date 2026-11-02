-- 편성 그룹과 그룹 편성. 기기의 화면 설정(layout·rotation_seconds·refresh_after_seconds)을 그룹 편성으로 옮긴다.
-- 1. 그룹이 없는 기기는 "기본" 그룹(grp_default)에 넣는다. 같은 이름의 그룹이 이미 있으면 그 그룹을 쓴다.
-- 2. 기기의 편성 그룹은 기기 그룹 id 정렬의 첫 번째다.
-- 3. 그룹 settings는 그 그룹을 따르는 기기들에서 가장 많은 값이다(같으면 정렬상 앞의 값). 기기가 없으면 기본값이다.
--    다른 값을 가진 기기는 그 키만 lineup_overrides.settings에 둔다.
-- 4. 그룹마다 포스터 블록 하나를 둔다. 지금 TV 동작과 같다.
-- 옛 컬럼은 0019가 지운다.
CREATE TYPE "public"."lineup_block_source" AS ENUM('SUBMISSIONS', 'PROGRAM');--> statement-breakpoint
CREATE TABLE "group_lineups" (
	"group_id" varchar(64) PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineup_blocks" (
	"group_id" varchar(64) NOT NULL,
	"id" varchar(48) NOT NULL,
	"position" integer NOT NULL,
	"source" "lineup_block_source" NOT NULL,
	"submission_type" "submission_type",
	"program_id" varchar(64),
	"duration_seconds" integer NOT NULL,
	"per_visit" integer,
	"schedule" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "lineup_blocks_group_id_id_pk" PRIMARY KEY("group_id","id"),
	CONSTRAINT "lineup_blocks_source_fields" CHECK (case "lineup_blocks"."source"
        when 'SUBMISSIONS' then "lineup_blocks"."submission_type" is not null and "lineup_blocks"."per_visit" is not null and "lineup_blocks"."program_id" is null
        when 'PROGRAM' then "lineup_blocks"."program_id" is not null and "lineup_blocks"."submission_type" is null and "lineup_blocks"."per_visit" is null
      end),
	CONSTRAINT "lineup_blocks_duration_range" CHECK ("lineup_blocks"."duration_seconds" between 5 and 300)
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"type" varchar(32) NOT NULL,
	"name" varchar(40) NOT NULL,
	"params" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "program_group_id" varchar(64);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "lineup_overrides" jsonb DEFAULT '{"settings":{},"blocks":{}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "group_lineups" ADD CONSTRAINT "group_lineups_group_id_target_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."target_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_lineups" ADD CONSTRAINT "group_lineups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_blocks" ADD CONSTRAINT "lineup_blocks_group_id_group_lineups_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group_lineups"("group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_blocks" ADD CONSTRAINT "lineup_blocks_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_blocks_group_position_uq" ON "lineup_blocks" USING btree ("group_id","position");--> statement-breakpoint
CREATE INDEX "lineup_blocks_program_idx" ON "lineup_blocks" USING btree ("program_id");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_program_group_id_target_groups_id_fk" FOREIGN KEY ("program_group_id") REFERENCES "public"."target_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "target_groups" ("id", "name")
SELECT 'grp_default', '기본'
WHERE EXISTS (
    SELECT 1 FROM "devices" d
    WHERE NOT EXISTS (SELECT 1 FROM "device_target_groups" dtg WHERE dtg."device_id" = d."id")
  )
  AND NOT EXISTS (
    SELECT 1 FROM "target_groups" WHERE "id" = 'grp_default' OR lower("name") = '기본'
  );--> statement-breakpoint
INSERT INTO "device_target_groups" ("device_id", "target_group_id")
SELECT d."id", g."id"
FROM "devices" d
CROSS JOIN LATERAL (
  SELECT "id" FROM "target_groups"
  WHERE "id" = 'grp_default' OR lower("name") = '기본'
  ORDER BY ("id" = 'grp_default') DESC, "id"
  LIMIT 1
) g
WHERE NOT EXISTS (SELECT 1 FROM "device_target_groups" dtg WHERE dtg."device_id" = d."id");--> statement-breakpoint
UPDATE "devices" d
SET "program_group_id" = (
  SELECT min("target_group_id") FROM "device_target_groups" WHERE "device_id" = d."id"
);--> statement-breakpoint
INSERT INTO "group_lineups" ("group_id", "settings", "updated_at")
SELECT
  g."id",
  jsonb_build_object(
    'posterLayout', coalesce(s."layout", 'WALL'),
    'rotationSeconds', coalesce(s."rotation_seconds", 10),
    'refreshAfterSeconds', coalesce(s."refresh_after_seconds", 60),
    'infoBar', '[]'::jsonb,
    'quietHours', '[]'::jsonb
  ),
  now()
FROM "target_groups" g
CROSS JOIN LATERAL (
  SELECT
    mode() WITHIN GROUP (ORDER BY d."layout"::text) AS "layout",
    mode() WITHIN GROUP (ORDER BY d."rotation_seconds") AS "rotation_seconds",
    mode() WITHIN GROUP (ORDER BY d."refresh_after_seconds") AS "refresh_after_seconds"
  FROM "devices" d
  WHERE d."program_group_id" = g."id"
) s;--> statement-breakpoint
UPDATE "devices" d
SET "lineup_overrides" = jsonb_build_object(
  'settings', jsonb_strip_nulls(jsonb_build_object(
    'posterLayout', CASE WHEN d."layout"::text <> l."settings"->>'posterLayout' THEN d."layout"::text END,
    'rotationSeconds', CASE WHEN d."rotation_seconds" <> (l."settings"->>'rotationSeconds')::int THEN d."rotation_seconds" END,
    'refreshAfterSeconds', CASE WHEN d."refresh_after_seconds" <> (l."settings"->>'refreshAfterSeconds')::int THEN d."refresh_after_seconds" END
  )),
  'blocks', '{}'::jsonb
)
FROM "group_lineups" l
WHERE l."group_id" = d."program_group_id";--> statement-breakpoint
INSERT INTO "lineup_blocks" ("group_id", "id", "position", "source", "submission_type", "duration_seconds", "per_visit", "schedule")
SELECT "group_id", 'blk_' || substr(md5(random()::text || "group_id"), 1, 12), 0, 'SUBMISSIONS', 'POSTER', 60, 3, '{"type":"ALWAYS"}'::jsonb
FROM "group_lineups";
