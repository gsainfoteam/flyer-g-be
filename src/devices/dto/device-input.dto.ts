import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { openApiOf } from '../../common/validation/zod.js';
import { deviceOrientationEnum, type Device } from '../../db/schema.js';
import { deviceOverridesSchema } from '../../lineups/lineup-schema.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

// rotationSeconds 설명. 편성 응답(DeviceLayoutDto)과 같은 뜻이다.
export const ROTATION_SECONDS_DESCRIPTION = `화면 한 장이 머무는 시간(초).
- WALL: 벽 한 쪽, 크게 보기 한 건이 각각 이 시간만큼 머문다
- STRIP: 띠가 한 칸 미는 간격이다`;

const MOVED_TO_LINEUP =
  '화면 설정은 그룹 편성(settings)이나 기기 예외(overrides.settings)로 바꿉니다.';

/**
 * 그룹 편성으로 옮긴 옛 화면 설정 필드. 조용히 무시하면 운영자가 저장된 줄 알기 때문에 422로 거절한다.
 * 정리 배포에서 지운다.
 */
function MovedToLineup(
  type: StringConstructor | NumberConstructor,
): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      description: `**받지 않는다(422).** ${MOVED_TO_LINEUP}`,
      type,
      deprecated: true,
    }),
    ValidateIf((_, value) => value !== undefined),
    Equals(undefined, { message: MOVED_TO_LINEUP }),
  );
}

const PROGRAM_GROUP_DOC = `편성을 따르는 그룹 ID. groupIds 중 하나여야 한다(아니면 422 fields.programGroupId).
groupIds는 포스터 등 신청의 대상 지정에만 쓰고, 화면 편성은 이 그룹의 편성(GET /signage/target-groups/{id}/lineup)을 따른다`;

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
    description:
      '기기가 속한 위치 그룹 (GET /signage/target-groups의 id). 수정할 때는 통째로 바꾼다. 숨긴 그룹은 새로 추가할 수 없지만 이미 연결된 것은 그대로 둘 수 있다',
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

  @MovedToLineup(String)
  layout?: unknown;

  @MovedToLineup(Number)
  rotationSeconds?: unknown;

  @MovedToLineup(Number)
  refreshAfterSeconds?: unknown;
}

export class CreateDeviceDto extends DeviceSettingsFields {
  @ApiPropertyOptional({
    description: `${PROGRAM_GROUP_DOC}. 생략하면 groupIds의 첫 번째다. groupIds도 비었으면 422`,
    example: 'grp_house_a',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: '편성 그룹이 올바르지 않습니다.' })
  programGroupId?: string;

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

  @ApiPropertyOptional({
    description: `${PROGRAM_GROUP_DOC}. groupIds를 바꾸면서 지금 편성 그룹을 빼려면 이 값도 같이 바꾼다`,
    example: 'grp_house_a',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: '편성 그룹이 올바르지 않습니다.' })
  programGroupId?: string;

  @ApiPropertyOptional({
    allOf: [openApiOf(deviceOverridesSchema, 'input')],
    description: `기기 예외. 통째로 바꾼다(빈 객체 {}는 예외 없음).
- settings: 바꿀 설정 키만 (infoBar·quietHours는 배열 전체)
- blocks: 편성 그룹의 블록 id → { enabled?, durationSeconds? }. 편성 그룹에 없는 블록 id는 저장할 때 지운다
- 정보줄이 가리키는 운영 컨텐츠는 있어야 하고 그 칸에 맞는 종류여야 한다. fields 키는 overrides.settings.infoBar.0.programId 같은 점 경로다`,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsObject({ message: '기기 예외가 올바르지 않습니다.' })
  overrides?: Record<string, unknown>;
}
