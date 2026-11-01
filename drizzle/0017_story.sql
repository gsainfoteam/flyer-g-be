-- 소식 제보. 기간은 승인 때 정하므로 승인 전에는 비어 있을 수 있다. 제보 번호는 승인 때 시퀀스에서 받는다.
-- 새 enum 값(STORY)은 같은 트랜잭션에서 쓸 수 없어 기간 CHECK는 종류 대신 상태로 적었다(마이그레이션은 한 트랜잭션에서 돈다).
CREATE TYPE "public"."story_tag" AS ENUM('NEWS', 'PRAISE', 'LOST_FOUND', 'SUGGESTION', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."reject_reason_code" ADD VALUE 'PERSONAL_INFO' BEFORE 'OTHER';--> statement-breakpoint
ALTER TYPE "public"."reject_reason_code" ADD VALUE 'DEFAMATION' BEFORE 'OTHER';--> statement-breakpoint
ALTER TYPE "public"."reject_reason_code" ADD VALUE 'ADVERTISEMENT' BEFORE 'OTHER';--> statement-breakpoint
ALTER TYPE "public"."submission_type" ADD VALUE 'STORY';--> statement-breakpoint
CREATE SEQUENCE "public"."story_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "submission_stories" (
	"submission_id" uuid PRIMARY KEY NOT NULL,
	"tag" "story_tag" NOT NULL,
	"body" varchar(140) NOT NULL,
	"story_number" integer,
	CONSTRAINT "submission_stories_story_number_unique" UNIQUE("story_number")
);
--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "start_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "end_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_stories" ADD CONSTRAINT "submission_stories_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_period_both_or_neither" CHECK (("submissions"."start_at" is null) = ("submissions"."end_at" is null));--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_period_after_approval" CHECK ("submissions"."start_at" is not null or "submissions"."status" in ('DRAFT', 'PENDING_REVIEW', 'REJECTED', 'CANCELED', 'ARCHIVED'));