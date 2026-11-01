import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { storyTagEnum, type StoryTag } from '../../db/schema.js';

export const RECENT_STORIES_MAX = 10;

export class RecentStoriesQueryDto {
  @ApiPropertyOptional({
    description: '몇 건',
    minimum: 1,
    maximum: RECENT_STORIES_MAX,
    default: 5,
  })
  @Transform(({ value }) =>
    value === '' || value === undefined ? 5 : Number(value),
  )
  @IsInt({ message: 'limit은 정수여야 합니다.' })
  @Min(1, { message: 'limit은 1 이상이어야 합니다.' })
  @Max(RECENT_STORIES_MAX, {
    message: `limit은 ${RECENT_STORIES_MAX} 이하여야 합니다.`,
  })
  limit: number = 5;
}

/** 공개 목록의 제보 한 건. 작성자와 신청 id는 싣지 않는다 */
export class RecentStoryDto {
  @ApiProperty({ example: 128 })
  storyNumber: number;

  @ApiProperty({ enum: storyTagEnum.enumValues, example: 'PRAISE' })
  tag: StoryTag;

  @ApiProperty({
    example: 'B동 3층 세탁실 건조기 2번이 고쳐졌어요. 관리실에 감사드려요!',
  })
  body: string;

  @ApiProperty({
    description: '게시 시작(= 승인 시각)',
    example: '2026-10-31T03:00:00.000Z',
  })
  startAt: string;
}

export class RecentStoriesDto {
  @ApiProperty({ type: [RecentStoryDto] })
  items: RecentStoryDto[];
}
