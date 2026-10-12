import { ApiProperty } from '@nestjs/swagger';
import {
  reviewDecisionEnum,
  submissionStatusEnum,
  type ReviewDecision,
  type SubmissionStatus,
} from '../../db/schema.js';

const STATUSES = submissionStatusEnum.enumValues;

/** 목록·상세 공통 형태 (요구사항 5.1). 참조는 화면 표시용으로 해소해 함께 준다. */
export class SubmissionDto {
  @ApiProperty({ example: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34' })
  id: string;

  @ApiProperty({
    description: 'detailUrl이 Ziggle 공지 주소일 때 서버가 뽑은 공지 ID',
    type: String,
    nullable: true,
    example: '1041',
  })
  ziggleNoticeId: string | null;

  @ApiProperty({ example: '6f1c2c1e-0000-4000-8000-000000000001' })
  requesterId: string;

  @ApiProperty({
    description: '신청자 이름. 검토 화면에서 누가 올렸는지 보여준다',
    example: '홍길동',
  })
  requesterName: string;

  @ApiProperty({ enum: ['POSTER'], example: 'POSTER' })
  type: 'POSTER';

  @ApiProperty({ example: '겨울 정기 공연 〈한밤의 물리학〉' })
  title: string;

  @ApiProperty({ example: 'performance' })
  categoryId: string;

  @ApiProperty({ description: '카테고리 표시 이름', example: '공연' })
  categoryName: string;

  @ApiProperty({ example: '0f8e2c1a-5b7d-4e21-9a0c-1d8e5f6b2c34' })
  assetId: string;

  @ApiProperty({
    description: '포스터 미리보기 (1280x1280 안)',
    example:
      'https://gsainfoteam-icarus-flyer-g-production.s3.ap-northeast-2.amazonaws.com/assets/0f8e2c1a-.../preview.webp',
  })
  posterUrl: string;

  @ApiProperty({
    description: '포스터 썸네일 (400x400 안). 목록 카드용',
    example:
      'https://gsainfoteam-icarus-flyer-g-production.s3.ap-northeast-2.amazonaws.com/assets/0f8e2c1a-.../thumb.webp',
  })
  posterThumbUrl: string;

  @ApiProperty({
    description:
      '포스터 종류. 지금은 IMAGE만 있다. VIDEO는 영상 업로드를 열면 생긴다',
    enum: ['IMAGE', 'VIDEO'],
    example: 'IMAGE',
  })
  posterKind: 'IMAGE' | 'VIDEO';

  @ApiProperty({
    description:
      '포스터 원본 가로(px, EXIF 회전 적용 후). 미리보기는 1280px 안으로 줄였으므로 해상도 판단은 이 값으로 한다',
    example: 1536,
  })
  posterWidth: number;

  @ApiProperty({
    description: '포스터 원본 세로(px, EXIF 회전 적용 후)',
    example: 2048,
  })
  posterHeight: number;

  @ApiProperty({
    description: '영상 포스터의 길이(ms). 이미지는 null',
    type: Number,
    nullable: true,
    example: null,
  })
  posterDurationMs: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://ziggle.gistory.me/notice/1041',
  })
  detailUrl: string | null;

  @ApiProperty({ example: '2026-07-30T00:00:00.000Z' })
  startAt: string;

  @ApiProperty({ example: '2026-08-06T14:59:59.000Z' })
  endAt: string;

  @ApiProperty({
    description:
      '저장된 상태. APPROVED인데 시작 전이면 예약, 종료 후면 종료처럼 기간과 함께 판정한다(기준 시각은 serverTime)',
    enum: STATUSES,
    example: 'PENDING_REVIEW',
  })
  status: SubmissionStatus;

  @ApiProperty({ description: '편성 우선순위 (운영자가 정함)', example: 0 })
  priority: number;

  @ApiProperty({
    description: '대상 위치 그룹. 비어 있으면 전체 기기',
    type: [String],
    example: [],
  })
  targetGroupIds: string[];

  @ApiProperty({
    description: '주최 (자유 입력)',
    type: String,
    nullable: true,
    example: '공연동아리 페이드인',
  })
  organizerName: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '12월 셋째 주 금요일 저녁',
  })
  subtitle: string | null;

  @ApiProperty({ type: String, nullable: true, example: '대강당' })
  location: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  description: string | null;

  @ApiProperty({
    description: '낙관적 잠금 버전. 수정·상태 변경 요청에 그대로 실어 보낸다',
    example: 1,
  })
  version: number;

  @ApiProperty({
    description: `가장 최근 검토 결정 (검토 이력 중 reviewedAt이 가장 늦은 것). 한 번도 검토되지 않았으면 null.
상태가 PENDING_REVIEW일 때 null이면 처음 낸 신청, REJECTED면 반려 뒤 고쳐서 다시 냄, SUSPENDED면 중단 뒤 다시 냄, APPROVED면 승인 뒤 수정해 재승인이 필요함`,
    enum: reviewDecisionEnum.enumValues,
    nullable: true,
    example: 'REJECTED',
  })
  lastDecision: ReviewDecision | null;

  @ApiProperty({
    description: '마지막으로 검토를 요청한 시각',
    type: String,
    nullable: true,
    example: '2026-07-29T06:30:00.000Z',
  })
  submittedAt: string | null;

  @ApiProperty({ example: '2026-07-29T06:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-07-29T06:30:00.000Z' })
  updatedAt: string;
}

/** 단건 응답. 목록 봉투가 없으므로 판정 기준 시각을 함께 준다. */
export class SubmissionDetailDto extends SubmissionDto {
  @ApiProperty({
    description: '서버 현재 시각(UTC). 표시 상태 판정은 이 값으로 한다',
    example: '2026-07-29T06:30:00.000Z',
  })
  serverTime: string;
}

export class SubmissionStatusCountsDto {
  @ApiProperty() DRAFT: number;
  @ApiProperty() PENDING_REVIEW: number;
  @ApiProperty() REJECTED: number;
  @ApiProperty() APPROVED: number;
  @ApiProperty() SCHEDULED: number;
  @ApiProperty() PUBLISHED: number;
  @ApiProperty() ENDED: number;
  @ApiProperty() SUSPENDED: number;
  @ApiProperty() CANCELED: number;
  @ApiProperty() ARCHIVED: number;
}

export class SubmissionSummaryDto {
  @ApiProperty({
    description: '집계 기준 시각. 아래 수치는 이 시각 기준이다',
    example: '2026-07-29T06:30:00.000Z',
  })
  calculatedAt: string;

  @ApiProperty({ description: 'ARCHIVED를 뺀 전체', example: 42 })
  total: number;

  @ApiProperty({
    description: '지금 게시 중 (승인됐고 기간 안)',
    example: 7,
  })
  published: number;

  @ApiProperty({ description: '승인됐고 시작 전', example: 5 })
  scheduled: number;

  @ApiProperty({ description: '검토 대기', example: 3 })
  pendingReview: number;

  @ApiProperty({
    description: '게시가 끝남 (ENDED이거나 승인 건의 기간이 지남)',
    example: 27,
  })
  ended: number;

  @ApiProperty({
    description: '저장된 상태별 건수. 목록 탭 배지용 (기간 보정 없음)',
    type: SubmissionStatusCountsDto,
  })
  byStatus: SubmissionStatusCountsDto;
}
