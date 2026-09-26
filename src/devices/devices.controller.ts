import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { BEARER_AUTH } from '../config/swagger.js';
import type { Device } from '../db/schema.js';
import { CurrentDevice, DeviceAuth } from './auth/device-auth.js';
import { DevicesService } from './devices.service.js';
import { CreateDeviceDto, UpdateDeviceDto } from './dto/device-input.dto.js';
import {
  DeviceDto,
  DeviceSessionDto,
  DeviceWithTokenDto,
} from './dto/device.dto.js';

const deviceIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppException(404, ErrorCode.NOT_FOUND, 'Device not found'),
});

const ID_PARAM = { name: 'id', description: '기기 ID' };
const NOT_FOUND_DOC = { description: '없는 기기', type: ErrorResponseDto };
const VALIDATION_DOC = {
  description: '입력 검증 실패. 없는·숨긴 위치 그룹은 fields.groupIds',
  type: ErrorResponseDto,
};
const SUPER_ADMIN_ONLY = {
  description: 'SUPER_ADMIN만 쓸 수 있다',
  type: ErrorResponseDto,
};

/** 운영자용 기기 관리 (요구사항 11.1). 조회는 검토자도, 변경은 SUPER_ADMIN만 한다. */
@ApiTags('Devices')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage/devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @Roles('REVIEWER')
  @ApiOperation({ summary: '기기 목록', description: '이름순. 검토자 이상.' })
  @ApiOkResponse({ type: [DeviceDto] })
  @ApiForbiddenResponse({
    description: 'REVIEWER·SUPER_ADMIN만 볼 수 있다',
    type: ErrorResponseDto,
  })
  list(): Promise<DeviceDto[]> {
    return this.devicesService.list();
  }

  @Get(':id')
  @Roles('REVIEWER')
  @ApiOperation({ summary: '기기 상세', description: '검토자 이상.' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: DeviceDto })
  @ApiForbiddenResponse({
    description: 'REVIEWER·SUPER_ADMIN만 볼 수 있다',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  findOne(@Param('id', deviceIdPipe) id: string): Promise<DeviceDto> {
    return this.devicesService.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '기기 등록',
    description: `TV를 등록하고 기기 토큰을 발급한다. **토큰 원문은 이 응답에서만 볼 수 있다.**

TV 설정: 프론트가 \`https://<프론트>/display/{id}#token={token}\` 같은 설정 링크를 만들어 TV에서 한 번 연다.
\`#\` 뒤는 서버로 전송되지 않아 로그에 남지 않는다. 이후 TV는 토큰을 \`X-Device-Token\` 헤더로 보낸다.`,
  })
  @ApiCreatedResponse({ type: DeviceWithTokenDto })
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiUnprocessableEntityResponse(VALIDATION_DOC)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDeviceDto,
  ): Promise<DeviceWithTokenDto> {
    return this.devicesService.create(user, dto);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '기기 수정',
    description:
      '보낸 필드만 바꾼다. `isActive: false`면 비활성(DISABLED)이 되어 토큰으로 접근할 수 없다. `groupIds`는 통째로 바꾼다.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: DeviceDto })
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiUnprocessableEntityResponse(VALIDATION_DOC)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', deviceIdPipe) id: string,
    @Body() dto: UpdateDeviceDto,
  ): Promise<DeviceDto> {
    return this.devicesService.update(user, id, dto);
  }

  @Post(':id/rotate-token')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '기기 토큰 재발급',
    description:
      '새 토큰을 발급하고 **이전 토큰은 즉시 무효**가 된다. 토큰을 잃어버렸거나 유출됐을 때 쓴다. 새 토큰은 이 응답에서만 볼 수 있다.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: DeviceWithTokenDto })
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  rotateToken(
    @CurrentUser() user: AuthUser,
    @Param('id', deviceIdPipe) id: string,
  ): Promise<DeviceWithTokenDto> {
    return this.devicesService.rotateToken(user, id);
  }
}

/** TV가 부르는 API. 사용자 로그인이 아니라 기기 토큰으로 인증한다. */
@ApiTags('Device runtime')
@Controller('signage/devices')
export class DeviceRuntimeController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get(':deviceId/session')
  @DeviceAuth()
  @ApiOperation({
    summary: '기기 토큰 확인',
    description:
      'TV 설정 화면에서 토큰이 맞는지, 어느 기기로 등록됐는지 확인한다. 경로의 deviceId는 토큰의 기기와 같아야 한다.',
  })
  @ApiParam({ name: 'deviceId', description: '기기 ID' })
  @ApiOkResponse({ type: DeviceSessionDto })
  @ApiUnauthorizedResponse({
    description:
      '토큰이 없거나 틀렸거나, 비활성 기기이거나, 재발급으로 무효가 된 토큰',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: '경로의 deviceId가 토큰의 기기와 다름',
    type: ErrorResponseDto,
  })
  session(@CurrentDevice() device: Device): DeviceSessionDto {
    return this.devicesService.session(device);
  }
}
