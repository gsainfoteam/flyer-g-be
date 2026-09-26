import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SIGNAGE_POLICY } from '../../policy/signage-policy.js';

const TITLE_MAX_LENGTH = SIGNAGE_POLICY.titleMaxLength;

/** 앞뒤 공백을 지운다. 빈 문자열은 null(비움)로 본다. */
const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// offset 없는 시각은 서버와 브라우저가 다르게 해석해 하루가 어긋날 수 있다.
const WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const DATE_MESSAGE =
  '시각은 UTC ISO 8601 형식이어야 합니다. (예: 2026-07-30T00:00:00.000Z)';

/** 생성·수정에 공통인 선택 입력. 모두 화면 표시용이며 null이면 비운다. */
class SubmissionDisplayFields {
  @ApiPropertyOptional({
    description:
      '상세 링크(QR). 허용된 호스트의 HTTPS만. Ziggle 공지 주소면 서버가 공지 ID를 뽑아 중복 신청을 막는다',
    example: 'https://ziggle.gistory.me/notice/1041',
    nullable: true,
    type: String,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: '주소가 올바르지 않습니다.' })
  @MaxLength(2048, { message: '주소가 너무 깁니다.' })
  detailUrl?: string | null;

  @ApiPropertyOptional({
    description: '주최. 미리보기와 TV에 "주최"로 표시된다',
    example: '공연동아리 페이드인',
    nullable: true,
    type: String,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '주최는 100자 이하여야 합니다.' })
  organizerName?: string | null;

  @ApiPropertyOptional({
    description: '부제 (예: 일시 안내)',
    example: '12월 셋째 주 금요일 저녁',
    nullable: true,
    type: String,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '부제는 100자 이하여야 합니다.' })
  subtitle?: string | null;

  @ApiPropertyOptional({
    description: '장소',
    example: '대강당',
    nullable: true,
    type: String,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '장소는 100자 이하여야 합니다.' })
  location?: string | null;

  @ApiPropertyOptional({
    description: '설명',
    example: null,
    nullable: true,
    type: String,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: '설명은 1000자 이하여야 합니다.' })
  description?: string | null;
}

export class CreateSubmissionDto extends SubmissionDisplayFields {
  @ApiProperty({
    description: `제목. 앞뒤 공백을 지운 뒤 1~${TITLE_MAX_LENGTH}자`,
    example: '겨울 정기 공연 〈한밤의 물리학〉',
  })
  @Transform(trim)
  @IsString({ message: '제목을 입력하세요.' })
  @IsNotEmpty({ message: '제목을 입력하세요.' })
  @MaxLength(TITLE_MAX_LENGTH, {
    message: `제목은 ${TITLE_MAX_LENGTH}자 이하여야 합니다.`,
  })
  title: string;

  @ApiProperty({
    description: 'GET /signage/categories의 id',
    example: 'performance',
  })
  @IsString({ message: '카테고리를 선택하세요.' })
  @IsNotEmpty({ message: '카테고리를 선택하세요.' })
  categoryId: string;

  @ApiProperty({
    description: '업로드를 완료(complete)한 본인의 asset',
    example: '0f8e2c1a-5b7d-4e21-9a0c-1d8e5f6b2c34',
  })
  @IsUUID('all', { message: '포스터를 올려주세요.' })
  assetId: string;

  @ApiProperty({
    description: '게시 시작 (UTC ISO 8601)',
    example: '2026-07-30T00:00:00.000Z',
  })
  @IsISO8601({ strict: true }, { message: DATE_MESSAGE })
  @Matches(WITH_OFFSET, { message: DATE_MESSAGE })
  startAt: string;

  @ApiProperty({
    description: '게시 종료 (UTC ISO 8601)',
    example: '2026-08-06T14:59:59.000Z',
  })
  @IsISO8601({ strict: true }, { message: DATE_MESSAGE })
  @Matches(WITH_OFFSET, { message: DATE_MESSAGE })
  endAt: string;

  @ApiPropertyOptional({
    description:
      'GET /signage/target-groups의 id 목록. 비우면 전체 기기가 대상',
    type: [String],
    example: [],
    default: [],
  })
  @IsOptional()
  @IsArray({ message: '대상 위치가 올바르지 않습니다.' })
  @ArrayMaxSize(50, { message: '대상 위치는 50개까지 고를 수 있습니다.' })
  @ArrayUnique({ message: '같은 대상 위치를 두 번 고를 수 없습니다.' })
  @IsString({ each: true, message: '대상 위치가 올바르지 않습니다.' })
  targetGroupIds?: string[];
}

export class UpdateSubmissionDto extends SubmissionDisplayFields {
  @ApiProperty({
    description: '화면에서 본 version. 최신이 아니면 409 CONFLICT',
    example: 3,
  })
  @IsInt({ message: 'version이 올바르지 않습니다.' })
  @Min(1)
  version: number;

  @ApiPropertyOptional({ example: '겨울 정기 공연' })
  @Transform(trim)
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: '제목을 입력하세요.' })
  @IsNotEmpty({ message: '제목을 입력하세요.' })
  @MaxLength(TITLE_MAX_LENGTH, {
    message: `제목은 ${TITLE_MAX_LENGTH}자 이하여야 합니다.`,
  })
  title?: string;

  @ApiPropertyOptional({ example: 'performance' })
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: '카테고리를 선택하세요.' })
  @IsNotEmpty({ message: '카테고리를 선택하세요.' })
  categoryId?: string;

  @ApiPropertyOptional({
    description: '포스터를 바꿀 때 새로 업로드한 asset',
    example: '5a1b2c3d-5b7d-4e21-9a0c-1d8e5f6b2c34',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('all', { message: '포스터를 올려주세요.' })
  assetId?: string;

  @ApiPropertyOptional({ example: '2026-07-31T00:00:00.000Z' })
  @ValidateIf((_, value) => value !== undefined)
  @IsISO8601({ strict: true }, { message: DATE_MESSAGE })
  @Matches(WITH_OFFSET, { message: DATE_MESSAGE })
  startAt?: string;

  @ApiPropertyOptional({ example: '2026-08-07T14:59:59.000Z' })
  @ValidateIf((_, value) => value !== undefined)
  @IsISO8601({ strict: true }, { message: DATE_MESSAGE })
  @Matches(WITH_OFFSET, { message: DATE_MESSAGE })
  endAt?: string;

  @ApiPropertyOptional({ type: [String], example: ['grp_house_a'] })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray({ message: '대상 위치가 올바르지 않습니다.' })
  @ArrayMaxSize(50, { message: '대상 위치는 50개까지 고를 수 있습니다.' })
  @ArrayUnique({ message: '같은 대상 위치를 두 번 고를 수 없습니다.' })
  @IsString({ each: true, message: '대상 위치가 올바르지 않습니다.' })
  targetGroupIds?: string[];
}

/** 상태만 바꾸는 요청(제출·취소)의 본문 */
export class SubmissionVersionDto {
  @ApiProperty({
    description: '화면에서 본 version. 최신이 아니면 409 CONFLICT',
    example: 3,
  })
  @IsInt({ message: 'version이 올바르지 않습니다.' })
  @Min(1)
  version: number;
}
