import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const GROUP_NAME_MAX_LENGTH = 40;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const NAME_DOC = {
  description: `표시 이름. 앞뒤 공백을 지운 뒤 1~${GROUP_NAME_MAX_LENGTH}자. 대소문자를 무시하고 다른 그룹(숨긴 그룹 포함)과 겹치면 422 fields.name`,
  example: '학사기숙사 A동',
  minLength: 1,
  maxLength: GROUP_NAME_MAX_LENGTH,
};

export class CreateTargetGroupDto {
  @ApiProperty(NAME_DOC)
  @Transform(trim)
  @IsString({ message: '그룹 이름을 입력하세요.' })
  @IsNotEmpty({ message: '그룹 이름을 입력하세요.' })
  @MaxLength(GROUP_NAME_MAX_LENGTH, {
    message: `그룹 이름은 ${GROUP_NAME_MAX_LENGTH}자 이하여야 합니다.`,
  })
  name: string;
}

export class UpdateTargetGroupDto {
  @ApiPropertyOptional(NAME_DOC)
  @Transform(trim)
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: '그룹 이름을 입력하세요.' })
  @IsNotEmpty({ message: '그룹 이름을 입력하세요.' })
  @MaxLength(GROUP_NAME_MAX_LENGTH, {
    message: `그룹 이름은 ${GROUP_NAME_MAX_LENGTH}자 이하여야 합니다.`,
  })
  name?: string;

  @ApiPropertyOptional({
    description:
      'true면 숨긴다. 숨겨도 이미 연결된 기기·신청과 편성은 그대로이고, 기기·신청에 새로 추가하는 것만 막힌다',
    example: true,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean({ message: '숨김 여부가 올바르지 않습니다.' })
  isHidden?: boolean;
}
