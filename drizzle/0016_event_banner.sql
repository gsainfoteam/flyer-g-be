-- 이벤트 배너. 이미지(IMAGE)나 사진(TEMPLATE)은 포스터처럼 submissions.asset_id에 두므로 포스터 전용 컬럼만 비워 둘 수 있게 바꾼다.
-- 노출 자리 SCENE은 포스터 묶음 밖의 장면 한 장(이벤트 배너, 제보 카드)이다.
CREATE TYPE "public"."event_banner_mode" AS ENUM('TEMPLATE', 'IMAGE');--> statement-breakpoint
CREATE TYPE "public"."event_banner_occasion" AS ENUM('BIRTHDAY', 'ADMISSION', 'AWARD', 'WELCOME', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."play_placement" ADD VALUE 'SCENE';--> statement-breakpoint
ALTER TYPE "public"."submission_type" ADD VALUE 'EVENT_BANNER';--> statement-breakpoint
CREATE TABLE "submission_event_banners" (
	"submission_id" uuid PRIMARY KEY NOT NULL,
	"mode" "event_banner_mode" NOT NULL,
	"occasion" "event_banner_occasion",
	"recipient" varchar(20) NOT NULL,
	"message" varchar(60),
	"sender" varchar(20),
	"photo_consent" boolean DEFAULT false NOT NULL,
	CONSTRAINT "submission_event_banners_template_fields" CHECK ("submission_event_banners"."mode" <> 'TEMPLATE' or ("submission_event_banners"."occasion" is not null and "submission_event_banners"."message" is not null)),
	CONSTRAINT "submission_event_banners_consent_template_only" CHECK ("submission_event_banners"."mode" = 'TEMPLATE' or not "submission_event_banners"."photo_consent")
);
--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "asset_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_event_banners" ADD CONSTRAINT "submission_event_banners_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_poster_fields" CHECK ("submissions"."type" <> 'POSTER' or ("submissions"."category_id" is not null and "submissions"."asset_id" is not null));--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_category_poster_only" CHECK ("submissions"."type" = 'POSTER' or "submissions"."category_id" is null);