import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  deviceOrientationEnum,
  displayLayoutEnum,
  type Device,
} from '../../db/schema.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

// 프론트 플레이어가 이 범위로 잘라 쓰므로(요구사항 8.2) 서버도 같은 범위만 저장한다.
export const ROTATION_SECONDS_RANGE = { min: 5, max: 60 } as const;
export const REFRESH_SECONDS_RANGE = { min: 15, max: 300 } as const;

/** 생성·수정에 공통인 선택 설정 */
class DeviceSettingsFields {
  @ApiPropertyOptional({
    description: '설치 위치 설명',
    example: '학사기숙사 A동 1층',
    type: String,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '위치는 200자 이하여야 합니다.' })
  location?: string | null;

  @ApiPropertyOptional({
    description: '기기가 속한 위치 그룹 (GET /signage/target-groups의 id)',
    type: [String],
    example: ['grp_house_a'],
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray({ message: '위치 그룹이 올바르지 않습니다.' })
  @ArrayMaxSize(50)
  @ArrayUnique({ message: '같은 위치 그룹을 두 번 고를 수 없습니다.' })
  @IsString({ each: true, message: '위치 그룹이 올바르지 않습니다.' })
  groupIds?: string[];

  @ApiPropertyOptional({
    enum: deviceOrientationEnum.enumValues,
    description: 'MVP는 LANDSCAPE만 쓴다',
    default: 'LANDSCAPE',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(deviceOrientationEnum.enumValues, {
    message: '화면 방향이 올바르지 않습니다.',
  })
  orientation?: Device['orientation'];

  @ApiPropertyOptional({
    enum: displayLayoutEnum.enumValues,
    description: '편성 응답의 layout.type',
    default: 'FOUR_GRID',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(displayLayoutEnum.enumValues, {
    message: '레이아웃이 올바르지 않습니다.',
  })
  layout?: Device['layout'];

  @ApiPropertyOptional({
    description: '포스터 전환 간격(초)',
    minimum: ROTATION_SECONDS_RANGE.min,
    maximum: ROTATION_SECONDS_RANGE.max,
    default: 10,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt({ message: '전환 간격은 정수(초)여야 합니다.' })
  @Min(ROTATION_SECONDS_RANGE.min, {
    message: `전환 간격은 ${ROTATION_SECONDS_RANGE.min}초 이상이어야 합니다.`,
  })
  @Max(ROTATION_SECONDS_RANGE.max, {
    message: `전환 간격은 ${ROTATION_SECONDS_RANGE.max}초 이하여야 합니다.`,
  })
  rotationSeconds?: number;

  @ApiPropertyOptional({
    description:
      '편성 갱신 주기(초). 게시 중단이 기기에 반영되기까지의 최대 시간이다',
    minimum: REFRESH_SECONDS_RANGE.min,
    maximum: REFRESH_SECONDS_RANGE.max,
    default: 60,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt({ message: '갱신 주기는 정수(초)여야 합니다.' })
  @Min(REFRESH_SECONDS_RANGE.min, {
    message: `갱신 주기는 ${REFRESH_SECONDS_RANGE.min}초 이상이어야 합니다.`,
  })
  @Max(REFRESH_SECONDS_RANGE.max, {
    message: `갱신 주기는 ${REFRESH_SECONDS_RANGE.max}초 이하여야 합니다.`,
  })
  refreshAfterSeconds?: number;
}

export class CreateDeviceDto extends DeviceSettingsFields {
  @ApiProperty({ description: '기기 이름', example: 'A동 로비 TV' })
  @Transform(trim)
  @IsString({ message: '기기 이름을 입력하세요.' })
  @IsNotEmpty({ message: '기기 이름을 입력하세요.' })
  @MaxLength(100, { message: '기기 이름은 100자 이하여야 합니다.' })
  name: string;
}

export class UpdateDeviceDto extends DeviceSettingsFields {
  @ApiPropertyOptional({ example: 'A동 로비 TV (왼쪽)' })
  @Transform(trim)
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: '기기 이름을 입력하세요.' })
  @IsNotEmpty({ message: '기기 이름을 입력하세요.' })
  @MaxLength(100, { message: '기기 이름은 100자 이하여야 합니다.' })
  name?: string;

  @ApiPropertyOptional({
    description: 'false면 비활성(DISABLED). 토큰이 있어도 편성을 받을 수 없다',
    example: true,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean({ message: '활성 여부가 올바르지 않습니다.' })
  isActive?: boolean;
}
