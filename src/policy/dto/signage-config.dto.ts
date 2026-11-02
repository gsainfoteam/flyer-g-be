import { ApiProperty } from '@nestjs/swagger';
import type { SubmissionType } from '../../db/schema.js';
import { ASSET_MIME_TYPES, type AssetMimeType } from '../signage-policy.js';

export class SignageConfigDto {
  @ApiProperty({ description: '이미지 최대 용량(바이트)', example: 10485760 })
  maxUploadBytes: number;

  @ApiProperty({ description: '영상 최대 용량(바이트)', example: 104857600 })
  maxVideoUploadBytes: number;

  @ApiProperty({ description: '영상 최대 길이(초)', example: 30 })
  maxVideoDurationSeconds: number;

  @ApiProperty({
    description: '제목 최대 글자 수 (앞뒤 공백 제외)',
    example: 80,
  })
  titleMaxLength: number;

  @ApiProperty({
    description:
      '최대 게시 기간(개월). 종료 시각은 시작 시각에서 이 개월 수를 더한 시각(Asia/Seoul 달력 기준) 이하여야 한다',
    example: 3,
  })
  maxPublishMonths: number;

  @ApiProperty({
    description:
      '이벤트 배너의 최대 게시 일수. 시작·종료는 서울 자정(00:00)이어야 하고, 길이는 1일 이상 이 일수 이하',
    example: 3,
  })
  eventBannerMaxDays: number;

  @ApiProperty({
    description:
      '**지원 중단.** 예전의 "게시 24시간 전 신청" 규칙. 규칙이 없어져 항상 0이고, 정리 배포에서 필드를 지운다. 읽지 않는다',
    example: 0,
    deprecated: true,
  })
  minLeadTimeHours: 0;

  @ApiProperty({
    description:
      '사용자당 서울 하루 신청 한도(종류 → 건수). 한도가 있는 종류만 들어 있다. 넘으면 429 DAILY_LIMIT_EXCEEDED',
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: { EVENT_BANNER: 3 },
  })
  dailySubmissionLimits: Partial<Record<SubmissionType, number>>;

  @ApiProperty({
    description:
      '지금 업로드를 받는 MIME. 영상(video/*)은 영상 업로드를 연 환경에서만 들어 있다. 들어 있지 않으면 영상 업로드 UI를 숨긴다',
    enum: ASSET_MIME_TYPES,
    isArray: true,
    example: ['image/jpeg', 'image/png', 'image/webp'],
  })
  allowedMimeTypes: AssetMimeType[];

  @ApiProperty({
    description: '상세 링크(QR)로 허용하는 호스트. HTTPS만 허용한다',
    type: [String],
    example: ['ziggle.gistory.me'],
  })
  allowedDetailUrlHosts: string[];
}
