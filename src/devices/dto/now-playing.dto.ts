import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const NOW_PLAYING_KINDS = [
  'SUBMISSIONS',
  'PROGRAM',
  'LIVE',
  'IDLE',
  'QUIET',
] as const;
export type NowPlayingKind = (typeof NOW_PLAYING_KINDS)[number];

/** devices.now_playing에 저장하는 값. 시각은 ISO(UTC)로 맞춰 둔다 */
export type NowPlaying = {
  blockId: string | null;
  live: boolean;
  kind: NowPlayingKind;
  label: string | null;
  submissionIds: string[];
  startedAt: string;
  endsAt: string | null;
};

const WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const TIME_MESSAGE = '시간대가 있는 ISO 시각이어야 합니다.';

/**
 * TV가 heartbeat로 알리는 "지금 장면"(FE 요청 4). 서버는 판정하지 않고 마지막 값을 그대로 기기 응답에 싣는다.
 * 시각은 기기 시계 기준이다.
 */
export class NowPlayingDto {
  @ApiProperty({
    description:
      '지금 블록 ID(편성 v2의 blocks[].id). 라이브·화면 끔·대기면 null',
    type: String,
    nullable: true,
    example: 'blk_3f9a1c2b7d4e',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: '블록 ID가 올바르지 않습니다.' })
  @MaxLength(48, { message: '블록 ID가 올바르지 않습니다.' })
  blockId: string | null;

  @ApiProperty({ description: '라이브 상태를 띄우는 중인가', example: false })
  @IsBoolean({ message: 'live가 올바르지 않습니다.' })
  live: boolean;

  @ApiProperty({
    description:
      'SUBMISSIONS: 신청 컨텐츠 블록, PROGRAM: 운영 컨텐츠 블록, LIVE: 라이브, IDLE: 띄울 것 없음, QUIET: 화면 끔 시간',
    enum: NOW_PLAYING_KINDS,
    example: 'PROGRAM',
  })
  @IsIn(NOW_PLAYING_KINDS, { message: '장면 종류가 올바르지 않습니다.' })
  kind: NowPlayingKind;

  @ApiProperty({
    description: 'TV가 붙인 표시 이름(60자까지). 없으면 null',
    type: String,
    nullable: true,
    example: '오늘의 학식',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: '표시 이름이 올바르지 않습니다.' })
  @MaxLength(60, { message: '표시 이름은 60자 이하여야 합니다.' })
  label: string | null;

  @ApiProperty({
    description: '지금 화면에 보이는 신청 컨텐츠 ID (30개까지)',
    type: [String],
    example: [],
  })
  @IsArray({ message: '신청 ID 목록이 올바르지 않습니다.' })
  @ArrayMaxSize(30, { message: '신청 ID는 30개까지입니다.' })
  @IsUUID('all', { each: true, message: '신청 ID가 올바르지 않습니다.' })
  submissionIds: string[];

  @ApiProperty({
    description: '이 장면이 시작된 시각(기기 시계)',
    example: '2026-10-30T03:09:52.000Z',
  })
  @IsISO8601({ strict: true }, { message: TIME_MESSAGE })
  @Matches(WITH_OFFSET, { message: TIME_MESSAGE })
  startedAt: string;

  @ApiProperty({
    description: '이 장면이 끝날 예정 시각(기기 시계). 정해지지 않았으면 null',
    type: String,
    nullable: true,
    example: '2026-10-30T03:10:07.000Z',
  })
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true }, { message: TIME_MESSAGE })
  @Matches(WITH_OFFSET, { message: TIME_MESSAGE })
  endsAt: string | null;
}
