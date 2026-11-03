import { ApiProperty } from '@nestjs/swagger';
import {
  eventBannerModeEnum,
  eventBannerOccasionEnum,
  storyTagEnum,
  type EventBannerMode,
  type EventBannerOccasion,
  type StoryTag,
} from '../../db/schema.js';
import { LineupBlockDto, SETTINGS_DOC } from '../../lineups/dto/lineup.dto.js';
import type { LineupSettings } from '../../lineups/lineup-schema.js';
import { PlaylistLiveDto } from '../../live/dto/live.dto.js';
import { PlaylistItemDto } from './playlist.dto.js';

/** 포스터가 아닌 신청 항목의 공통 필드 */
class PlaylistEntryDto {
  @ApiProperty({ example: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34' })
  submissionId: string;

  @ApiProperty({
    description: '신청 version. 내용이 바뀌면 오른다',
    example: 2,
  })
  revision: number;

  @ApiProperty({ example: '2026-10-30T15:00:00.000Z' })
  startsAt: string;

  @ApiProperty({ example: '2026-10-31T15:00:00.000Z' })
  endsAt: string;

  @ApiProperty({
    description:
      '항목 내용(문구와 미디어)의 sha256. 내용이 같으면 항상 같고, 다르면 반드시 다르다',
    example:
      'sha256:9f2b5c0e3a1d4f6b8c7e9a0d1f2e3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c',
  })
  checksum: string;
}

/** 이벤트 배너. TEMPLATE은 TV가 문구로 그리고, IMAGE는 assetUrl을 띄운다 */
export class EventBannerPlaylistItemDto extends PlaylistEntryDto {
  @ApiProperty({ enum: eventBannerModeEnum.enumValues, example: 'TEMPLATE' })
  mode: EventBannerMode;

  @ApiProperty({
    description: 'TEMPLATE의 경우. IMAGE는 null',
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
    description: 'TEMPLATE의 사진(TV용, 1920x1080 안, webp). 없으면 null',
    type: String,
    nullable: true,
    example: null,
  })
  photoUrl: string | null;

  @ApiProperty({
    description: 'IMAGE 배너 이미지(TV용, 1920x1080 안, webp). TEMPLATE은 null',
    type: String,
    nullable: true,
    example: null,
  })
  assetUrl: string | null;

  @ApiProperty({
    description: 'photoUrl·assetUrl 원본 가로(px). 미디어가 없으면 null',
    type: Number,
    nullable: true,
    example: null,
  })
  width: number | null;

  @ApiProperty({
    description: 'photoUrl·assetUrl 원본 세로(px). 미디어가 없으면 null',
    type: Number,
    nullable: true,
    example: null,
  })
  height: number | null;
}

/** 소식 제보. 작성자는 싣지 않는다 */
export class StoryPlaylistItemDto extends PlaylistEntryDto {
  @ApiProperty({ description: 'TV에 #128로 나온다', example: 128 })
  storyNumber: number;

  @ApiProperty({ enum: storyTagEnum.enumValues, example: 'PRAISE' })
  tag: StoryTag;

  @ApiProperty({
    example: 'B동 3층 세탁실 건조기 2번이 고쳐졌어요. 관리실에 감사드려요!',
  })
  body: string;
}

/** 이 기기 대상이고 지금 게시 중인 신청. 종류마다 우선순위 높은 순, 같으면 시작이 이른 순 */
export class PlaylistSubmissionsDto {
  @ApiProperty({
    description: '포스터. v1 items와 같은 모양',
    type: [PlaylistItemDto],
  })
  POSTER: PlaylistItemDto[];

  @ApiProperty({ type: [EventBannerPlaylistItemDto] })
  EVENT_BANNER: EventBannerPlaylistItemDto[];

  @ApiProperty({ type: [StoryPlaylistItemDto] })
  STORY: StoryPlaylistItemDto[];
}

export class PlaylistProgramDto {
  @ApiProperty({
    description: '운영 컨텐츠 종류 (GET /signage/program-types)',
    example: 'DAILY_PILLAR',
  })
  type: string;

  @ApiProperty({ example: '오늘의 일진' })
  name: string;

  @ApiProperty({
    description: '운영자가 정한 설정. 종류의 paramsSchema 모양이다',
    type: 'object',
    additionalProperties: true,
    example: {},
  })
  params: Record<string, unknown>;

  @ApiProperty({
    description: `서버가 만든 데이터. dataSource가 NONE인 종류(DDAY·EXAM_CHEER·CLICK_BATTLE)는 null
- DAILY_PILLAR: { date: 서울 날짜, name: '신사', hanja: '辛巳', stem: '신', branch: '사', animal: '뱀' }. 서울 자정에 바뀐다`,
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: {
      date: '2026-11-03',
      name: '신사',
      hanja: '辛巳',
      stem: '신',
      branch: '사',
      animal: '뱀',
    },
  })
  data: Record<string, unknown> | null;
}

/** 편성 응답 v2 (`?v=2`). 그룹 편성과 기기 예외를 합친 결과다 */
export class PlaylistV2Dto {
  @ApiProperty({
    description:
      '서버 현재 시각. 게시 기간·노출 일정 판정과 오프라인 시각 보정의 기준이다',
    example: '2026-10-30T03:10:00.000Z',
  })
  serverTime: string;

  @ApiProperty({
    description: '노출 일정·화면 끔 시간의 기준 시간대',
    example: 'Asia/Seoul',
  })
  timezone: 'Asia/Seoul';

  @ApiProperty({ example: 'A동 로비 1' })
  deviceName: string;

  @ApiProperty({
    description:
      'serverTime을 뺀 응답 전체의 해시. ETag 헤더와 같은 값이다. v1의 playlistVersion과는 다르다',
    example: '4c1d9a7e2b3f5a60',
  })
  playlistVersion: string;

  @ApiProperty({
    description:
      '다음 편성 요청까지 기다릴 시간(초). settings.refreshAfterSeconds와 같다',
    example: 60,
  })
  refreshAfterSeconds: number;

  @ApiProperty({ ...SETTINGS_DOC, description: '기기 예외를 반영한 편성 설정' })
  settings: LineupSettings;

  @ApiProperty({
    description:
      '기기 예외를 반영한 블록. 배열 순서가 재생 순서다. 꺼진 블록(enabled=false)은 빼고 보낸다. 노출 일정(schedule)은 TV가 판정한다',
    type: [LineupBlockDto],
  })
  blocks: LineupBlockDto[];

  @ApiProperty({ type: PlaylistSubmissionsDto })
  submissions: PlaylistSubmissionsDto;

  @ApiProperty({
    description:
      '블록과 정보줄이 가리키는 운영 컨텐츠. 운영 컨텐츠 ID → 내용. 꺼진 블록만 가리키는 것은 싣지 않는다',
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/PlaylistProgramDto' },
    example: {},
  })
  programs: Record<string, PlaylistProgramDto>;

  @ApiProperty({
    description: `이 기기가 지금 띄울 라이브(기기 값, 없으면 그룹 값. main과 alert를 따로 고른다). 없으면 null
- until이 지난 부분은 null이다. TV도 until을 보고 스스로 내린다
- SHOW가 가리키는 신청은 이 기기 대상이 아니어도 submissions에 실린다. 게시 중이 아니면 main이 null이다
- SHOW가 가리키는 운영 컨텐츠는 programs에 실린다. 지워졌으면 main이 null이다
- 운영자 정보(setBy)는 싣지 않는다`,
    type: PlaylistLiveDto,
    nullable: true,
  })
  live: PlaylistLiveDto | null;
}
