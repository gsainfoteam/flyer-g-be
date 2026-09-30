import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  CursorField,
  LimitField,
} from '../../common/pagination/cursor-query.dto.js';
import { auditActorTypeEnum } from '../../db/schema.js';
import { AUDIT_ACTIONS, type AuditAction } from '../audit.service.js';

export const AUDIT_TARGET_TYPES = ['SUBMISSION', 'DEVICE'] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({
    description:
      '대상 종류. 검토자가 아니면 SUBMISSION과 본인 신청의 targetId를 함께 보내야 한다',
    enum: AUDIT_TARGET_TYPES,
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(AUDIT_TARGET_TYPES, { message: '알 수 없는 대상 종류입니다.' })
  targetType?: AuditTargetType;

  @ApiPropertyOptional({
    description: '대상 ID (신청 ID, 기기 ID)',
    example: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;

  @ApiPropertyOptional({
    description:
      '행위 필터. 쉼표로 여러 개를 보내면 그중 하나에 해당하는 로그를 준다. 모르는 값이 섞이면 422',
    example: 'SUBMISSION_APPROVED,SUBMISSION_REJECTED,SUBMISSION_SUSPENDED',
    type: String,
  })
  @Transform(({ value }) => {
    // action=A,B와 action=A&action=B를 같게 받는다
    const raw: unknown = Array.isArray(value) ? value.join(',') : value;
    return typeof raw === 'string' && raw !== ''
      ? [...new Set(raw.split(',').map((action) => action.trim()))]
      : undefined;
  })
  @IsOptional()
  @IsArray()
  @IsIn(AUDIT_ACTIONS, { each: true, message: '알 수 없는 행위가 있습니다.' })
  action?: AuditAction[];

  @CursorField()
  cursor?: string;

  @LimitField(20)
  limit: number = 20;
}

/** 감사 로그 한 건 (요구사항 11.2) */
export class AuditLogDto {
  @ApiProperty({ example: '4a7b1c2d-5b7d-4e21-9a0c-1d8e5f6b2c34' })
  id: string;

  @ApiProperty({
    description: 'USER: 사용자, DEVICE: 기기, SYSTEM: 서버의 주기 작업',
    enum: auditActorTypeEnum.enumValues,
    example: 'USER',
  })
  actorType: (typeof auditActorTypeEnum.enumValues)[number];

  @ApiProperty({
    description: '행위자 ID. SYSTEM이면 null',
    type: String,
    nullable: true,
    example: '6f1c2c1e-0000-4000-8000-000000000002',
  })
  actorId: string | null;

  @ApiProperty({
    description: '행위자 이름 (사용자일 때). SYSTEM이거나 삭제된 사용자면 null',
    type: String,
    nullable: true,
    example: '김관리',
  })
  actorName: string | null;

  @ApiProperty({
    description: `행위. 신청: SUBMISSION_CREATED, _UPDATED, _RESUBMITTED, _CANCELED, _APPROVED, _REJECTED, _SUSPENDED, _SCHEDULED, _PUBLISHED, _ENDED
기기: DEVICE_REGISTERED, DEVICE_UPDATED, DEVICE_TOKEN_ROTATED`,
    example: 'SUBMISSION_APPROVED',
  })
  action: string;

  @ApiProperty({ enum: AUDIT_TARGET_TYPES, example: 'SUBMISSION' })
  targetType: string;

  @ApiProperty({ example: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34' })
  targetId: string;

  @ApiProperty({
    description: '반려 의견·중단 사유 등',
    type: String,
    nullable: true,
    example: null,
  })
  reason: string | null;

  @ApiProperty({
    description: '행위별 부가 정보 (바뀐 필드, 이전·이후 상태, revision 등)',
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { revision: 3, toStatus: 'SCHEDULED' },
  })
  metadata: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-07-29T02:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    description: '이 변경을 만든 요청의 ID (x-request-id). 주기 작업이면 null',
    type: String,
    nullable: true,
    example: 'req_Xk3p7QaZ1bN9vT2c',
  })
  requestId: string | null;
}
