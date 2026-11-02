import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { openApiOf, ZodBody } from '../common/validation/zod.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { LiveDto } from './dto/live.dto.js';
import { liveInputSchema, type LiveInput } from './live-schema.js';
import { LiveService } from './live.service.js';

const deviceIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppException(404, ErrorCode.NOT_FOUND, 'Device not found'),
});

const SUPER_ADMIN_ONLY = {
  description: 'SUPER_ADMIN만 쓸 수 있다',
  type: ErrorResponseDto,
};
const PUT_DESCRIPTION = `그 범위의 라이브를 통째로 바꾼다. 보내지 않거나 null인 부분은 해제된다. 둘 다 null이면 DELETE와 같다. 감사 로그 LIVE_SET

- 기기 라이브가 그룹 라이브보다 우선한다. main과 alert를 따로 고른다(기기에 alert만 있으면 main은 그룹 값)
- \`until\`이 지나면 서버는 그 부분을 없는 것으로 보고, TV도 \`until\`을 보고 스스로 내린다
- SHOW가 가리키는 신청은 대상 그룹이 아니어도 된다. 게시 중이 아니거나 운영 컨텐츠가 지워졌으면 편성 응답의 live.main이 null이다
- GAME.until은 필수이고 지금부터 3시간 안이다. 판이 끝나면 TV가 스스로 편성으로 돌아간다`;
const VALIDATION_DOC = {
  description:
    '입력 검증 실패. fields 키는 점 경로다(예: main.until, main.game.rounds, alert.text). 없는 신청·운영 컨텐츠는 main.submissionId·main.programId',
  type: ErrorResponseDto,
};
const LIVE_RESPONSE = {
  description:
    '저장된 라이브(이 범위의 값). 없거나 해제했으면 모든 필드가 null',
  type: LiveDto,
};

/** 라이브 상태 (FE 요청 3-1). 기기와 그룹마다 하나다. 모두 SUPER_ADMIN */
@ApiTags('Live')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@ApiForbiddenResponse(SUPER_ADMIN_ONLY)
@Controller('signage')
export class LiveController {
  constructor(private readonly liveService: LiveService) {}

  @Put('devices/:id/live')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '기기 라이브 설정', description: PUT_DESCRIPTION })
  @ApiParam({ name: 'id', description: '기기 ID' })
  @ApiBody({ schema: openApiOf(liveInputSchema, 'input') })
  @ApiOkResponse(LIVE_RESPONSE)
  @ApiNotFoundResponse({ description: '없는 기기', type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(VALIDATION_DOC)
  setDevice(
    @CurrentUser() user: AuthUser,
    @Param('id', deviceIdPipe) id: string,
    @Body(new ZodBody(liveInputSchema)) input: LiveInput,
  ): Promise<LiveDto> {
    return this.liveService.set(user, 'DEVICE', id, input);
  }

  @Delete('devices/:id/live')
  @HttpCode(204)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '기기 라이브 해제',
    description:
      '이 기기의 라이브를 모두 해제한다("편성으로 돌아가기"). 그룹 라이브가 있으면 그것이 나온다. 해제할 것이 있었을 때만 감사 로그 LIVE_CLEARED',
  })
  @ApiParam({ name: 'id', description: '기기 ID' })
  @ApiNoContentResponse({ description: '해제함 (없었어도 204)' })
  @ApiNotFoundResponse({ description: '없는 기기', type: ErrorResponseDto })
  clearDevice(
    @CurrentUser() user: AuthUser,
    @Param('id', deviceIdPipe) id: string,
  ): Promise<void> {
    return this.liveService.clear(user, 'DEVICE', id);
  }

  @Get('target-groups/:id/live')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '그룹 라이브 조회',
    description:
      '이 그룹에 저장된 라이브. until이 지난 부분은 null이고, 남은 것이 없으면 모든 필드가 null이다. 기기가 실제로 띄우는 값은 기기 응답의 live다',
  })
  @ApiParam({ name: 'id', description: '그룹 ID' })
  @ApiOkResponse(LIVE_RESPONSE)
  @ApiNotFoundResponse({ description: '없는 그룹', type: ErrorResponseDto })
  getGroup(@Param('id') id: string): Promise<LiveDto> {
    return this.liveService.get('GROUP', id);
  }

  @Put('target-groups/:id/live')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '그룹 라이브 설정',
    description: `그룹에 속한(groupIds에 이 그룹이 있는) 모든 기기에 나간다. 기기가 여러 그룹에 속하면 가장 최근에 정한 그룹 값을 쓴다.\n\n${PUT_DESCRIPTION}`,
  })
  @ApiParam({ name: 'id', description: '그룹 ID' })
  @ApiBody({ schema: openApiOf(liveInputSchema, 'input') })
  @ApiOkResponse(LIVE_RESPONSE)
  @ApiNotFoundResponse({ description: '없는 그룹', type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse(VALIDATION_DOC)
  setGroup(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodBody(liveInputSchema)) input: LiveInput,
  ): Promise<LiveDto> {
    return this.liveService.set(user, 'GROUP', id, input);
  }

  @Delete('target-groups/:id/live')
  @HttpCode(204)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '그룹 라이브 해제',
    description:
      '이 그룹의 라이브를 모두 해제한다. 기기 라이브는 그대로다. 해제할 것이 있었을 때만 감사 로그 LIVE_CLEARED',
  })
  @ApiParam({ name: 'id', description: '그룹 ID' })
  @ApiNoContentResponse({ description: '해제함 (없었어도 204)' })
  @ApiNotFoundResponse({ description: '없는 그룹', type: ErrorResponseDto })
  clearGroup(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.liveService.clear(user, 'GROUP', id);
  }
}
