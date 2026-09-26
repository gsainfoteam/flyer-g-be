import { ApiProperty } from '@nestjs/swagger';
import { ALLOWED_MIME_TYPES, type AllowedMimeType } from '../signage-policy.js';

export class SignageConfigDto {
  @ApiProperty({ description: '포스터 최대 용량(바이트)', example: 10485760 })
  maxUploadBytes: number;

  @ApiProperty({ description: '포스터 짧은 변 최소 픽셀', example: 1080 })
  minShortEdgePx: number;

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
      '게시 시작 전 최소 신청 시간(시간). 시작 시각은 신청 시각에서 이 시간 이상 뒤여야 한다. 0이면 제한 없음',
    example: 24,
  })
  minLeadTimeHours: number;

  @ApiProperty({
    description: '업로드 허용 MIME',
    enum: ALLOWED_MIME_TYPES,
    isArray: true,
    example: ALLOWED_MIME_TYPES,
  })
  allowedMimeTypes: AllowedMimeType[];

  @ApiProperty({
    description: '상세 링크(QR)로 허용하는 호스트. HTTPS만 허용한다',
    type: [String],
    example: ['ziggle.gistory.me'],
  })
  allowedDetailUrlHosts: string[];
}
