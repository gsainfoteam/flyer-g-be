import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  rejectReasonCodeEnum,
  reviewDecisionEnum,
  type RejectReasonCode,
  type ReviewDecision,
} from '../../db/schema.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const REVISION_DOC = {
  description:
    '검토자가 화면에서 본 신청 version. 최신이 아니면 409 CONFLICT (다른 관리자가 먼저 처리했거나 신청자가 고침)',
  example: 3,
};

export class ApproveSubmissionDto {
  @ApiProperty(REVISION_DOC)
  @IsInt({ message: 'revision이 올바르지 않습니다.' })
  @Min(1)
  revision: number;
}

export class RejectSubmissionDto {
  @ApiProperty(REVISION_DOC)
  @IsInt({ message: 'revision이 올바르지 않습니다.' })
  @Min(1)
  revision: number;

  @ApiProperty({
    description: '반려 사유 코드',
    enum: rejectReasonCodeEnum.enumValues,
    example: 'LOW_RESOLUTION',
  })
  @IsIn(rejectReasonCodeEnum.enumValues, {
    message: '반려 사유를 선택하세요.',
  })
  reasonCode: RejectReasonCode;

  @ApiProperty({
    description: '신청자에게 그대로 보이는 의견. 앞뒤 공백 제거 후 1~1000자',
    example:
      '짧은 변이 800px이라 TV에서 뭉개집니다. 1080px 이상으로 다시 올려주세요.',
  })
  @Transform(trim)
  @IsString({ message: '반려 의견을 입력하세요.' })
  @IsNotEmpty({ message: '반려 의견을 입력하세요.' })
  @MaxLength(1000, { message: '반려 의견은 1000자 이하여야 합니다.' })
  comment: string;
}

export class SuspendSubmissionDto {
  @ApiProperty({
    description:
      '중단 사유. 신청자에게 그대로 보인다. 앞뒤 공백 제거 후 1~1000자',
    example: '행사가 취소되어 즉시 내립니다.',
  })
  @Transform(trim)
  @IsString({ message: '중단 사유를 입력하세요.' })
  @IsNotEmpty({ message: '중단 사유를 입력하세요.' })
  @MaxLength(1000, { message: '중단 사유는 1000자 이하여야 합니다.' })
  reason: string;
}

/** 검토 이력 한 건 (요구사항 6.4) */
export class ReviewDto {
  @ApiProperty({ example: '2b7c9d1e-5b7d-4e21-9a0c-1d8e5f6b2c34' })
  id: string;

  @ApiProperty({ example: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34' })
  submissionId: string;

  @ApiProperty({
    description: '검토자가 보고 결정한 신청 version',
    example: 2,
  })
  revision: number;

  @ApiProperty({
    description: 'SUSPENDED는 게시 중단 기록이다',
    enum: reviewDecisionEnum.enumValues,
    example: 'REJECTED',
  })
  decision: ReviewDecision;

  @ApiProperty({
    description: '반려일 때만 값이 있다',
    enum: rejectReasonCodeEnum.enumValues,
    nullable: true,
    example: 'LOW_RESOLUTION',
  })
  reasonCode: RejectReasonCode | null;

  @ApiProperty({
    description: '반려 의견 또는 중단 사유. 승인이면 null',
    type: String,
    nullable: true,
    example: '짧은 변이 800px이라...',
  })
  comment: string | null;

  @ApiProperty({ example: '6f1c2c1e-0000-4000-8000-000000000002' })
  reviewerId: string;

  @ApiProperty({ example: '김관리' })
  reviewerName: string;

  @ApiProperty({ example: '2026-07-28T01:20:00.000Z' })
  reviewedAt: string;
}
