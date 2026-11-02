import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  eventBannerModeEnum,
  eventBannerOccasionEnum,
  type EventBannerMode,
  type EventBannerOccasion,
} from '../../db/schema.js';

export const EVENT_BANNER_TEXT_LIMITS = {
  recipient: 20,
  message: 60,
  sender: 20,
} as const;

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * 이벤트 배너 입력. 수정할 때도 전체를 보낸다(빠진 선택 필드는 비운 것으로 본다).
 * - TEMPLATE: TV가 문구로 그린다. occasion·message가 필요하고, 사진(photoAssetId)은 선택이다
 * - IMAGE: 올린 이미지(assetId)를 그대로 띄운다
 *
 * 여기서는 필드마다 형태만 본다. 형식에 따른 규칙은 kinds/event-banner.kind.ts가 본다.
 */
export class EventBannerInputDto {
  @ApiProperty({ enum: eventBannerModeEnum.enumValues, example: 'TEMPLATE' })
  @IsIn(eventBannerModeEnum.enumValues, {
    message: '배너 형식을 고르세요.',
  })
  mode: EventBannerMode;

  @ApiPropertyOptional({
    description: '무슨 소식인지. TEMPLATE은 필수, IMAGE는 선택',
    enum: eventBannerOccasionEnum.enumValues,
    nullable: true,
    example: 'BIRTHDAY',
  })
  @IsOptional()
  @IsIn(eventBannerOccasionEnum.enumValues, {
    message: '어떤 소식인지 고르세요.',
  })
  occasion?: EventBannerOccasion | null;

  @ApiProperty({
    description: `받는 사람. 앞뒤 공백을 지운 뒤 1~${EVENT_BANNER_TEXT_LIMITS.recipient}자`,
    example: '지민',
  })
  @Transform(trimToNull)
  @IsString({ message: '받는 사람을 입력하세요.' })
  @IsNotEmpty({ message: '받는 사람을 입력하세요.' })
  @MaxLength(EVENT_BANNER_TEXT_LIMITS.recipient, {
    message: `받는 사람은 ${EVENT_BANNER_TEXT_LIMITS.recipient}자 이하여야 합니다.`,
  })
  recipient: string;

  @ApiPropertyOptional({
    description: `전할 말. 앞뒤 공백을 지운 뒤 1~${EVENT_BANNER_TEXT_LIMITS.message}자. TEMPLATE은 필수, IMAGE는 선택`,
    type: String,
    nullable: true,
    example: '스물한 살 생일 축하해! 오늘 하루는 네가 주인공',
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: '전할 말이 올바르지 않습니다.' })
  @MaxLength(EVENT_BANNER_TEXT_LIMITS.message, {
    message: `전할 말은 ${EVENT_BANNER_TEXT_LIMITS.message}자 이하여야 합니다.`,
  })
  message?: string | null;

  @ApiPropertyOptional({
    description: `보내는 사람. 0~${EVENT_BANNER_TEXT_LIMITS.sender}자`,
    type: String,
    nullable: true,
    example: '3층 친구들',
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: '보내는 사람이 올바르지 않습니다.' })
  @MaxLength(EVENT_BANNER_TEXT_LIMITS.sender, {
    message: `보내는 사람은 ${EVENT_BANNER_TEXT_LIMITS.sender}자 이하여야 합니다.`,
  })
  sender?: string | null;

  @ApiPropertyOptional({
    description:
      'TEMPLATE에 넣을 사진. 업로드를 완료한 본인의 이미지 asset. 있으면 photoConsent가 true여야 한다. IMAGE에는 쓸 수 없다',
    type: String,
    nullable: true,
    example: null,
  })
  @IsOptional()
  @IsUUID('all', { message: '사진을 다시 올려주세요.' })
  photoAssetId?: string | null;

  @ApiPropertyOptional({
    description:
      '사진 속 사람의 동의를 받았다는 신청자의 확인. 사진이 있으면 true여야 한다',
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: '동의 확인 값이 올바르지 않습니다.' })
  photoConsent?: boolean;

  @ApiPropertyOptional({
    description:
      'IMAGE의 배너 이미지. 업로드를 완료한 본인의 이미지 asset. IMAGE는 필수, TEMPLATE에는 쓸 수 없다(사진은 photoAssetId)',
    type: String,
    nullable: true,
    example: null,
  })
  @IsOptional()
  @IsUUID('all', { message: '배너 이미지를 다시 올려주세요.' })
  assetId?: string | null;
}

/** 응답의 eventBanner. 입력과 같은 모양에 미리보기 주소를 더한다 */
export class EventBannerDto {
  @ApiProperty({ enum: eventBannerModeEnum.enumValues, example: 'TEMPLATE' })
  mode: EventBannerMode;

  @ApiProperty({
    enum: eventBannerOccasionEnum.enumValues,
    nullable: true,
    example: 'BIRTHDAY',
  })
  occasion: EventBannerOccasion | null;

  @ApiProperty({ example: '지민' })
  recipient: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '스물한 살 생일 축하해! 오늘 하루는 네가 주인공',
  })
  message: string | null;

  @ApiProperty({ type: String, nullable: true, example: '3층 친구들' })
  sender: string | null;

  @ApiProperty({
    description: 'TEMPLATE의 사진 asset. 없으면 null',
    type: String,
    nullable: true,
    example: null,
  })
  photoAssetId: string | null;

  @ApiProperty({
    description: '사진 미리보기 (1280x1280 안). 없으면 null',
    type: String,
    nullable: true,
    example: null,
  })
  photoUrl: string | null;

  @ApiProperty({ example: false })
  photoConsent: boolean;

  @ApiProperty({
    description: 'IMAGE의 배너 이미지 asset. TEMPLATE이면 null',
    type: String,
    nullable: true,
    example: null,
  })
  assetId: string | null;

  @ApiProperty({
    description: '배너 이미지 미리보기 (1280x1280 안). TEMPLATE이면 null',
    type: String,
    nullable: true,
    example: null,
  })
  assetUrl: string | null;
}
