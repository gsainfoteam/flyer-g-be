import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { storyTagEnum, type StoryTag } from '../../db/schema.js';

export const STORY_BODY_LIMITS = { min: 10, max: 140 } as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** 소식 제보 입력. 수정할 때도 전체를 보낸다 */
export class StoryInputDto {
  @ApiProperty({ enum: storyTagEnum.enumValues, example: 'PRAISE' })
  @IsIn(storyTagEnum.enumValues, { message: '말머리를 고르세요.' })
  tag: StoryTag;

  @ApiProperty({
    description: `본문. 앞뒤 공백을 지운 뒤 ${STORY_BODY_LIMITS.min}~${STORY_BODY_LIMITS.max}자. 줄바꿈을 쓸 수 있다`,
    example: 'B동 3층 세탁실 건조기 2번이 고쳐졌어요. 관리실에 감사드려요!',
  })
  @Transform(trim)
  @IsString({ message: '본문을 입력하세요.' })
  @MinLength(STORY_BODY_LIMITS.min, {
    message: `본문은 ${STORY_BODY_LIMITS.min}자 이상이어야 합니다.`,
  })
  @MaxLength(STORY_BODY_LIMITS.max, {
    message: `본문은 ${STORY_BODY_LIMITS.max}자 이하여야 합니다.`,
  })
  body: string;
}

/** 응답의 story */
export class StoryDto {
  @ApiProperty({ enum: storyTagEnum.enumValues, example: 'PRAISE' })
  tag: StoryTag;

  @ApiProperty({
    example: 'B동 3층 세탁실 건조기 2번이 고쳐졌어요. 관리실에 감사드려요!',
  })
  body: string;

  @ApiProperty({
    description:
      '제보 번호. 승인 때 정해지고 TV에 #128로 나온다. 승인 전이나 반려된 제보는 null',
    type: Number,
    nullable: true,
    example: 128,
  })
  storyNumber: number | null;
}
