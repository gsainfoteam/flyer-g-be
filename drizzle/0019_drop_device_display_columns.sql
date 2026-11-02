-- 0018이 그룹 편성으로 옮긴 기기 화면 설정 컬럼을 지운다. 모든 기기에 편성 그룹이 생겼으므로 NOT NULL로 바꾼다.
ALTER TABLE "devices" DROP CONSTRAINT "devices_rotation_seconds_range";--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_refresh_after_seconds_range";--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "program_group_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "devices_program_group_idx" ON "devices" USING btree ("program_group_id");--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "layout";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "rotation_seconds";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "refresh_after_seconds";--> statement-breakpoint
DROP TYPE "public"."display_layout";