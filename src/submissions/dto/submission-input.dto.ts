import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { submissionTypeEnum, type SubmissionType } from '../../db/schema.js';
import { SIGNAGE_POLICY } from '../../policy/signage-policy.js';
import { EventBannerInputDto } from './event-banner.dto.js';

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

/** 포스터 전용 필드는 포스터일 때만 검사한다. 다른 종류가 보내면 서비스가 422로 거절한다 */
const isPoster = (dto: CreateSubmissionDto) =>
  (dto.type ?? 'POSTER') === 'POSTER';

export class CreateSubmissionDto extends SubmissionDisplayFields {
  @ApiPropertyOptional({
    description:
      '신청 종류. 비우면 POSTER. 종류마다 받는 필드가 다르고, 그 종류가 받지 않는 필드를 보내면 422',
    enum: submissionTypeEnum.enumValues,
    default: 'POSTER',
  })
  @IsOptional()
  @IsIn(submissionTypeEnum.enumValues, {
    message: '알 수 없는 신청 종류입니다.',
  })
  type?: SubmissionType;

  @ApiPropertyOptional({
    description: `포스터만, 필수. 제목. 앞뒤 공백을 지운 뒤 1~${TITLE_MAX_LENGTH}자. 다른 종류는 서버가 만든다`,
    example: '겨울 정기 공연 〈한밤의 물리학〉',
  })
  @Transform(trim)
  @ValidateIf(isPoster)
  @IsString({ message: '제목을 입력하세요.' })
  @IsNotEmpty({ message: '제목을 입력하세요.' })
  @MaxLength(TITLE_MAX_LENGTH, {
    message: `제목은 ${TITLE_MAX_LENGTH}자 이하여야 합니다.`,
  })
  title?: string;

  @ApiPropertyOptional({
    description: '포스터만, 필수. GET /signage/categories의 id',
    example: 'performance',
  })
  @ValidateIf(isPoster)
  @IsString({ message: '카테고리를 선택하세요.' })
  @IsNotEmpty({ message: '카테고리를 선택하세요.' })
  categoryId?: string;

  @ApiPropertyOptional({
    description: '포스터만, 필수. 업로드를 완료(complete)한 본인의 asset',
    example: '0f8e2c1a-5b7d-4e21-9a0c-1d8e5f6b2c34',
  })
  @ValidateIf(isPoster)
  @IsUUID('all', { message: '포스터를 올려주세요.' })
  assetId?: string;

  @ApiPropertyOptional({
    description: 'EVENT_BANNER만, 필수. 이벤트 배너의 내용',
    type: EventBannerInputDto,
  })
  @ValidateIf((dto: CreateSubmissionDto) => dto.type === 'EVENT_BANNER')
  @IsObject({ message: '이벤트 배너 내용을 입력하세요.' })
  @ValidateNested()
  @Type(() => EventBannerInputDto)
  eventBanner?: EventBannerInputDto;

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
      'GET /signage/target-groups의 id 목록(숨긴 그룹 제외). 비우면 전체 기기가 대상',
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

  @ApiPropertyOptional({
    description:
      '대상 위치를 통째로 바꾼다. 새로 추가한 그룹 중 없거나 숨긴 그룹이 있으면 422 fields.targetGroupIds. 이미 연결된 숨긴 그룹은 그대로 둘 수 있다',
    type: [String],
    example: ['grp_house_a'],
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray({ message: '대상 위치가 올바르지 않습니다.' })
  @ArrayMaxSize(50, { message: '대상 위치는 50개까지 고를 수 있습니다.' })
  @ArrayUnique({ message: '같은 대상 위치를 두 번 고를 수 없습니다.' })
  @IsString({ each: true, message: '대상 위치가 올바르지 않습니다.' })
  targetGroupIds?: string[];

  @ApiPropertyOptional({
    description: 'EVENT_BANNER만. 바꿀 때는 내용 전체를 보낸다',
    type: EventBannerInputDto,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsObject({ message: '이벤트 배너 내용을 입력하세요.' })
  @ValidateNested()
  @Type(() => EventBannerInputDto)
  eventBanner?: EventBannerInputDto;
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
