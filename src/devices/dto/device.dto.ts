import { ApiProperty } from '@nestjs/swagger';
import { deviceOrientationEnum, type Device } from '../../db/schema.js';
import { OVERRIDES_DOC } from '../../lineups/dto/lineup.dto.js';
import { LiveDto } from '../../live/dto/live.dto.js';
import {
  POSTER_LAYOUTS,
  type DeviceOverrides,
  type PosterLayout,
} from '../../lineups/lineup-schema.js';
import { ROTATION_SECONDS_DESCRIPTION } from './device-input.dto.js';
import { NowPlayingDto } from './now-playing.dto.js';

export const DEVICE_STATUSES = [
  'ONLINE',
  'OFFLINE',
  'SLEEPING',
  'DISABLED',
] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export class ResolutionDto {
  @ApiProperty({ example: 1920 })
  width: number;

  @ApiProperty({ example: 1080 })
  height: number;
}

export class DeviceLayoutDto {
  @ApiProperty({
    description: 'WALL: 모아 보기, STRIP: 흐르는 띠',
    enum: POSTER_LAYOUTS,
    example: 'WALL',
  })
  type: PosterLayout;

  @ApiProperty({ description: ROTATION_SECONDS_DESCRIPTION, example: 10 })
  rotationSeconds: number;
}

/** 기기 정보 (요구사항 11.1). 토큰·해시는 절대 싣지 않는다. */
export class DeviceDto {
  @ApiProperty({ example: '3c1e9a7b-5b7d-4e21-9a0c-1d8e5f6b2c34' })
  id: string;

  @ApiProperty({ example: 'A동 로비 TV' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '학사기숙사 A동 1층',
  })
  location: string | null;

  @ApiProperty({
    description:
      '기기가 속한 위치 그룹. 신청의 대상 그룹과 겹치면 이 기기에 나온다',
    type: [String],
    example: ['grp_house_a'],
  })
  groupIds: string[];

  @ApiProperty({
    description: '편성을 따르는 그룹. groupIds 중 하나다',
    example: 'grp_house_a',
  })
  programGroupId: string;

  @ApiProperty({
    ...OVERRIDES_DOC,
    example: { settings: { posterLayout: 'STRIP' }, blocks: {} },
  })
  overrides: DeviceOverrides;

  @ApiProperty({
    enum: deviceOrientationEnum.enumValues,
    example: 'LANDSCAPE',
  })
  orientation: Device['orientation'];

  @ApiProperty({
    description: '기기가 마지막으로 알려 준 해상도. heartbeat 전에는 null',
    type: ResolutionDto,
    nullable: true,
  })
  resolution: ResolutionDto | null;

  @ApiProperty({
    description: '마지막 heartbeat 시각',
    type: String,
    nullable: true,
    example: '2026-07-29T06:29:50.000Z',
  })
  lastSeenAt: string | null;

  @ApiProperty({ type: String, nullable: true, example: '0.4.2' })
  appVersion: string | null;

  @ApiProperty({
    description:
      '기기가 heartbeat로 알린, 지금 재생 중인 편성 버전. 편성 API의 최신 playlistVersion과 다르면 동기화가 밀린 것이다',
    type: String,
    nullable: true,
    example: '9f2b5c0e3a1d4f6b',
  })
  lastPlaylistVersion: string | null;

  @ApiProperty({
    description:
      '기기가 마지막으로 포스터를 정상 렌더링한 시각(기기 시계 기준)',
    type: String,
    nullable: true,
    example: '2026-07-29T06:29:50.000Z',
  })
  lastRenderOkAt: string | null;

  @ApiProperty({
    description:
      '마지막 heartbeat가 알린 지금 장면(기기 시계 기준). 서버는 판정하지 않고 그대로 싣는다. 보내지 않는 옛 플레이어나 heartbeat 전에는 null',
    type: NowPlayingDto,
    nullable: true,
  })
  now: NowPlayingDto | null;

  @ApiProperty({
    description:
      '이 기기가 지금 띄우는 라이브(기기 값, 없으면 그룹 값. main과 alert를 따로 고른다). until이 지난 부분은 null이고, 없으면 null. 기기 목록의 "누가 덮어썼나"에 쓴다',
    type: LiveDto,
    nullable: true,
  })
  live: LiveDto | null;

  @ApiProperty({
    description: `판정 순서대로
- DISABLED: 비활성
- SLEEPING: 실제 편성의 화면 끔 시간(settings.quietHours, 서울 기준) 안. heartbeat가 없어도 OFFLINE으로 보지 않는다
- ONLINE: 90초 안에 heartbeat가 옴
- OFFLINE: 그 외(한 번도 안 온 경우 포함)`,
    enum: DEVICE_STATUSES,
    example: 'ONLINE',
  })
  status: DeviceStatus;

  @ApiProperty({
    description:
      '제어 채널(/devices/ws)이 연결돼 있는지. false면 새로고침 명령과 변경 알림이 가지 않고, TV는 refreshAfterSeconds마다 편성을 다시 받을 때 반영한다',
    example: true,
  })
  controlConnected: boolean;

  @ApiProperty({
    description:
      '**읽기 전용, 지원 중단.** 편성 그룹 설정에 기기 예외를 덮은 실제 값(posterLayout, rotationSeconds). 정리 배포에서 지운다',
    type: DeviceLayoutDto,
    deprecated: true,
  })
  layout: DeviceLayoutDto;

  @ApiProperty({
    description:
      '**읽기 전용, 지원 중단.** 실제 편성 갱신 주기(초). 정리 배포에서 지운다',
    example: 60,
    deprecated: true,
  })
  refreshAfterSeconds: number;

  @ApiProperty({
    description: '현재 토큰을 발급한 시각. 재발급하면 바뀐다',
    example: '2026-07-20T02:00:00.000Z',
  })
  tokenIssuedAt: string;

  @ApiProperty({ example: '2026-07-20T02:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-07-20T02:00:00.000Z' })
  updatedAt: string;
}

/** 기기 목록. "마지막 연결 N분 전"을 서버 시각 기준으로 계산하도록 serverTime을 함께 준다. */
export class DeviceListDto {
  @ApiProperty({
    description:
      '서버 현재 시각(UTC). lastSeenAt과 비교해 마지막 연결 경과 시간을 계산한다',
    example: '2026-07-29T06:30:00.000Z',
  })
  serverTime: string;

  @ApiProperty({ description: '이름순', type: [DeviceDto] })
  items: DeviceDto[];
}

/** 새로고침 명령 결과 */
export class DeviceReloadDto {
  @ApiProperty({
    description:
      '연결된 TV에 보냈는지. false면 제어 채널이 끊겨 있어 보내지 못했다(나중에 다시 보내지 않는다)',
    example: true,
  })
  delivered: boolean;
}

/** 등록·재발급 응답. 토큰 원문은 이때 한 번만 보여 준다. */
export class DeviceWithTokenDto extends DeviceDto {
  @ApiProperty({
    description: `기기 토큰 원문. **다시 조회할 수 없다.** TV에서 \`X-Device-Token\` 헤더로 보낸다.
TV 설정 링크는 프론트가 \`https://<프론트>/display/{id}#token={token}\`처럼 만든다 (#뒤는 서버로 전송되지 않는다).`,
    example: 'fgd_q8Zb2kX1n3VwY7tJ0rLmA9cD4eF6gH5iK2oP1sU3wX8',
  })
  token: string;
}

/** TV가 토큰이 맞는지, 어느 기기로 등록됐는지 확인하는 응답 */
export class DeviceSessionDto {
  @ApiProperty({ example: '3c1e9a7b-5b7d-4e21-9a0c-1d8e5f6b2c34' })
  deviceId: string;

  @ApiProperty({ example: 'A동 로비 TV' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '학사기숙사 A동 1층',
  })
  location: string | null;

  @ApiProperty({
    enum: deviceOrientationEnum.enumValues,
    example: 'LANDSCAPE',
  })
  orientation: Device['orientation'];

  @ApiProperty({
    description: '서버 현재 시각. 기기 시계 보정에 쓴다',
    example: '2026-07-29T06:30:00.000Z',
  })
  serverTime: string;
}
