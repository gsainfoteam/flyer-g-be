import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import type { Device } from '../db/schema.js';
import { CurrentDevice, DeviceAuth } from '../devices/auth/device-auth.js';
import { DeviceTelemetryService } from './device-telemetry.service.js';
import { HeartbeatDto } from './dto/heartbeat.dto.js';
import {
  MAX_EVENTS_PER_REQUEST,
  PlayEventsDto,
  PlayEventsResultDto,
} from './dto/play-events.dto.js';

const DEVICE_PARAM = {
  name: 'deviceId',
  description: '기기 ID (토큰의 기기와 같아야 한다)',
};
const UNAUTHORIZED_DOC = {
  description: '기기 토큰이 없거나 틀림, 비활성 기기',
  type: ErrorResponseDto,
};
const FORBIDDEN_DOC = {
  description: '경로의 deviceId가 토큰의 기기와 다름',
  type: ErrorResponseDto,
};

@ApiTags('Device runtime')
@Controller('signage/devices')
export class DeviceTelemetryController {
  constructor(private readonly telemetryService: DeviceTelemetryService) {}

  @Post(':deviceId/heartbeat')
  @HttpCode(204)
  @DeviceAuth()
  @ApiOperation({
    summary: 'heartbeat',
    description: `60초마다 보낸다. 최신 상태 하나만 의미가 있어 서버는 덮어쓴다.

- 기기 상태(ONLINE·OFFLINE)는 서버가 받은 시각으로 판정한다. 3분 안에 오면 ONLINE이다
- 실패해도 재생을 멈추지 않고 다음 주기를 기다린다(재전송 없음)
- 응답 본문은 없다(204)`,
  })
  @ApiParam(DEVICE_PARAM)
  @ApiNoContentResponse({ description: '기록함' })
  @ApiUnauthorizedResponse(UNAUTHORIZED_DOC)
  @ApiForbiddenResponse(FORBIDDEN_DOC)
  @ApiUnprocessableEntityResponse({
    description: '형식이 틀림',
    type: ErrorResponseDto,
  })
  async heartbeat(
    @CurrentDevice() device: Device,
    @Body() dto: HeartbeatDto,
  ): Promise<void> {
    await this.telemetryService.heartbeat(device, dto);
  }

  @Post(':deviceId/play-events')
  @HttpCode(200)
  @DeviceAuth()
  @ApiOperation({
    summary: '노출 이벤트',
    description: `30초마다, 그리고 네트워크가 복구되면 즉시 쌓인 이벤트를 보낸다.

- 사람이 본 횟수가 아니라 **기기가 포스터를 정상 렌더링한 기록**이다
- 서버가 (기기, eventId)로 중복을 거른다. 전송 성공 응답을 받기 전에 죽어 같은 batch를 다시 보내도 된다
- 한 번에 최대 ${MAX_EVENTS_PER_REQUEST}개. 오래 오프라인이었으면 나눠 보낸다
- 2xx면 전송 성공이다. 이벤트를 지워도 된다`,
  })
  @ApiParam(DEVICE_PARAM)
  @ApiOkResponse({ type: PlayEventsResultDto })
  @ApiUnauthorizedResponse(UNAUTHORIZED_DOC)
  @ApiForbiddenResponse(FORBIDDEN_DOC)
  @ApiUnprocessableEntityResponse({
    description: `형식이 틀리거나 ${MAX_EVENTS_PER_REQUEST}개를 넘음. fields는 events.0.eventId 형식`,
    type: ErrorResponseDto,
  })
  playEvents(
    @CurrentDevice() device: Device,
    @Body() dto: PlayEventsDto,
  ): Promise<PlayEventsResultDto> {
    return this.telemetryService.recordPlayEvents(device, dto.events);
  }
}
