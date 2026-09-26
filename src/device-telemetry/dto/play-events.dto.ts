import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// JSON 본문 한도(100KB) 안에 여유 있게 들어가는 수. 오래 오프라인이었으면 나눠 보낸다.
export const MAX_EVENTS_PER_REQUEST = 300;
const WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

export class PlayEventDto {
  @ApiProperty({
    description:
      '이벤트마다 기기가 만드는 UUID. 서버가 이 값으로 중복을 거른다',
    example: '5d1f0c2e-7b5d-4e21-9a0c-1d8e5f6b2c34',
  })
  @IsUUID()
  eventId: string;

  @ApiProperty({
    description: '플레이어 프로세스 하나를 가리키는 ID',
    example: 'ses_01J8ZK',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sessionId: string;

  @ApiProperty({ example: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34' })
  @IsUUID()
  submissionId: string;

  @ApiPropertyOptional({
    description: '편성 항목의 revision. 모르면 null',
    type: Number,
    nullable: true,
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  revision?: number | null;

  @ApiProperty({
    description: '렌더링을 시작한 시각(기기 시계, UTC ISO 8601)',
    example: '2026-07-29T06:28:00.000Z',
  })
  @IsISO8601({ strict: true })
  @Matches(WITH_OFFSET)
  startedAt: string;

  @ApiProperty({ description: '노출 시간(ms)', example: 10000 })
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60 * 1000)
  durationMs: number;

  @ApiProperty({
    description: '전환 간격을 다 채웠는지. 중간에 편성이 바뀌어 끊겼으면 false',
    example: true,
  })
  @IsBoolean()
  completed: boolean;
}

/** 요구사항 9.2 */
export class PlayEventsDto {
  @ApiProperty({
    description: `노출 이벤트 목록. 한 번에 최대 ${MAX_EVENTS_PER_REQUEST}개. 비어 있어도 된다`,
    type: [PlayEventDto],
  })
  @IsArray()
  @ArrayMaxSize(MAX_EVENTS_PER_REQUEST, {
    message: `한 번에 최대 ${MAX_EVENTS_PER_REQUEST}개까지 보낼 수 있습니다.`,
  })
  @ValidateNested({ each: true })
  @Type(() => PlayEventDto)
  events: PlayEventDto[];
}

export class PlayEventsResultDto {
  @ApiProperty({ description: '새로 저장한 이벤트 수', example: 12 })
  accepted: number;

  @ApiProperty({
    description: '이미 받은 이벤트라 건너뛴 수 (재전송·같은 batch 안 중복)',
    example: 0,
  })
  duplicates: number;
}
