-- 신청 종류. 지금은 포스터뿐이고 기존 행도 모두 포스터다. 다른 종류는 그 종류를 여는 마이그레이션에서 값을 더한다.
CREATE TYPE "public"."submission_type" AS ENUM('POSTER');--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "type" "submission_type" DEFAULT 'POSTER' NOT NULL;