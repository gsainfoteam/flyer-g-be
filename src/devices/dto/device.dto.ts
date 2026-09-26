import { ApiProperty } from '@nestjs/swagger';
import {
  deviceOrientationEnum,
  displayLayoutEnum,
  type Device,
} from '../../db/schema.js';

export const DEVICE_STATUSES = ['ONLINE', 'OFFLINE', 'DISABLED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export class ResolutionDto {
  @ApiProperty({ example: 1920 })
  width: number;

  @ApiProperty({ example: 1080 })
  height: number;
}

export class DeviceLayoutDto {
  @ApiProperty({ enum: displayLayoutEnum.enumValues, example: 'FOUR_GRID' })
  type: Device['layout'];

  @ApiProperty({ description: '포스터 전환 간격(초)', example: 10 })
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

  @ApiProperty({ type: [String], example: ['grp_house_a'] })
  groupIds: string[];

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
      'DISABLED: 비활성. ONLINE: 3분 안에 heartbeat가 옴. OFFLINE: 그 외(한 번도 안 온 경우 포함)',
    enum: DEVICE_STATUSES,
    example: 'ONLINE',
  })
  status: DeviceStatus;

  @ApiProperty({ type: DeviceLayoutDto })
  layout: DeviceLayoutDto;

  @ApiProperty({ description: '편성 갱신 주기(초)', example: 60 })
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
