import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Matches } from 'class-validator';
import {
  SUBMISSION_SCOPES,
  type SubmissionScope,
} from '../../submissions/dto/submission-query.dto.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class ImpressionStatsQueryDto {
  @ApiPropertyOptional({
    description: '시작 날짜(서울, 포함). 기본은 to의 29일 전 (30일)',
    example: '2026-07-01',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(DAY, { message: '날짜는 YYYY-MM-DD 형식이어야 합니다.' })
  from?: string;

  @ApiPropertyOptional({
    description: '끝 날짜(서울, 포함). 기본은 오늘',
    example: '2026-07-29',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(DAY, { message: '날짜는 YYYY-MM-DD 형식이어야 합니다.' })
  to?: string;

  @ApiPropertyOptional({
    description:
      'me: 내 게시물. all: 전체 (REVIEWER·SUPER_ADMIN만, 아니면 403)',
    enum: SUBMISSION_SCOPES,
    default: 'me',
  })
  @Transform(({ value }) =>
    value === '' || value === undefined ? 'me' : value,
  )
  @IsIn(SUBMISSION_SCOPES, { message: 'scope는 me 또는 all이어야 합니다.' })
  scope: SubmissionScope = 'me';

  @ApiPropertyOptional({
    description: '묶는 기준. 지금은 submission만',
    enum: ['submission'],
    default: 'submission',
  })
  @Transform(({ value }) =>
    value === '' || value === undefined ? 'submission' : value,
  )
  @IsIn(['submission'], { message: 'groupBy는 submission만 지원합니다.' })
  groupBy = 'submission' as const;
}

export class ImpressionStatsItemDto {
  @ApiProperty({ example: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34' })
  submissionId: string;

  @ApiProperty({ example: '겨울 정기 공연 〈한밤의 물리학〉' })
  title: string;

  @ApiProperty({
    description:
      '디스플레이가 포스터를 정상 렌더링한 횟수. 사람이 본 횟수가 아니다',
    example: 1840,
  })
  impressions: number;

  @ApiProperty({
    description: '그중 전환 간격을 다 채운 횟수',
    example: 1795,
  })
  completedImpressions: number;

  @ApiProperty({
    description: '기간 안에 한 번이라도 띄운 기기 수',
    example: 3,
  })
  deviceCount: number;
}

export class ImpressionStatsDto {
  @ApiProperty({ description: '시작 날짜(서울, 포함)', example: '2026-07-01' })
  from: string;

  @ApiProperty({ description: '끝 날짜(서울, 포함)', example: '2026-07-29' })
  to: string;

  @ApiProperty({
    description:
      '집계가 마지막으로 끝난 시각. 이후에 들어온 이벤트는 아직 반영되지 않았다(집계는 10분마다). 한 번도 안 돌았으면 null',
    type: String,
    nullable: true,
    example: '2026-07-29T06:30:00.000Z',
  })
  aggregatedAt: string | null;

  @ApiProperty({
    description: '노출이 많은 순. 기간 안에 노출이 없는 게시물은 없다',
    type: [ImpressionStatsItemDto],
  })
  items: ImpressionStatsItemDto[];
}
