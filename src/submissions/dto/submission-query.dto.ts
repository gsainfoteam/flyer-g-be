import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional } from 'class-validator';
import { CursorQueryDto } from '../../common/pagination/cursor-query.dto.js';
import {
  submissionStatusEnum,
  type SubmissionStatus,
} from '../../db/schema.js';

export const SUBMISSION_SCOPES = ['me', 'all'] as const;
export type SubmissionScope = (typeof SUBMISSION_SCOPES)[number];

const SCOPE_DESCRIPTION =
  'me: 내 신청. all: 전체 신청 (REVIEWER·SUPER_ADMIN만, 아니면 403)';

export class ListSubmissionsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    description: SCOPE_DESCRIPTION,
    enum: SUBMISSION_SCOPES,
    default: 'me',
  })
  @Transform(({ value }) =>
    value === '' || value === undefined ? 'me' : value,
  )
  @IsIn(SUBMISSION_SCOPES, { message: 'scope는 me 또는 all이어야 합니다.' })
  scope: SubmissionScope = 'me';

  @ApiPropertyOptional({
    description:
      '상태 복수 필터 (쉼표 구분). 비우면 ARCHIVED를 뺀 전체. ARCHIVED는 명시해야 나온다',
    example: 'APPROVED,SCHEDULED',
    type: String,
  })
  @Transform(({ value }) =>
    typeof value === 'string' && value !== ''
      ? value.split(',').map((status) => status.trim())
      : undefined,
  )
  @IsOptional()
  @IsArray()
  @IsIn(submissionStatusEnum.enumValues, {
    each: true,
    message: '알 수 없는 상태가 있습니다.',
  })
  statuses?: SubmissionStatus[];
}

export class SubmissionSummaryQueryDto {
  @ApiPropertyOptional({
    description: SCOPE_DESCRIPTION,
    enum: SUBMISSION_SCOPES,
    default: 'me',
  })
  @Transform(({ value }) =>
    value === '' || value === undefined ? 'me' : value,
  )
  @IsIn(SUBMISSION_SCOPES, { message: 'scope는 me 또는 all이어야 합니다.' })
  scope: SubmissionScope = 'me';
}
