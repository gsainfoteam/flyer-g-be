import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
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
import { openApiOf, ZodBody } from '../common/validation/zod.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { LineupDto } from './dto/lineup.dto.js';
import {
  lineupInputSchema,
  MAX_BLOCKS,
  type LineupInput,
} from './lineup-schema.js';
import { LineupsService } from './lineups.service.js';

const ID_PARAM = { name: 'id', description: '그룹 ID', example: 'grp_house_a' };
const SUPER_ADMIN_ONLY = {
  description: 'SUPER_ADMIN만 쓸 수 있다',
  type: ErrorResponseDto,
};
const NOT_FOUND_DOC = { description: '없는 그룹', type: ErrorResponseDto };

/** 그룹 편성. 기기는 편성 그룹(programGroupId)의 편성을 따르고, 기기 예외로 일부를 덮는다. */
@ApiTags('Lineups')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage/target-groups')
export class LineupsController {
  constructor(private readonly lineupsService: LineupsService) {}

  @Get(':id/lineup')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '그룹 편성 조회',
    description:
      '그룹마다 편성이 하나 있다. 그룹을 만들면 기본 편성(기본 설정과 포스터 블록 하나)이 같이 생기므로 있는 그룹이면 404가 나지 않는다.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: LineupDto })
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  get(@Param('id') id: string): Promise<LineupDto> {
    return this.lineupsService.get(id);
  }

  @Put(':id/lineup')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '그룹 편성 저장',
    description: `편성 전체를 바꾼다. 감사 로그 LINEUP_UPDATED (target GROUP).

- \`version\`은 GET에서 받은 값을 보낸다. 그사이 누가 저장했으면 409다.
- 블록은 ${MAX_BLOCKS}개까지이고 배열 순서가 재생 순서다. 기존 블록은 \`id\`를 그대로 보내고, 새 블록은 \`id\` 없이 보내면 서버가 \`blk_xxx\`를 발급한다. 보내지 않은 블록은 지워진다.
- SUBMISSIONS 블록은 \`submissionType\`·\`perVisit\`을, PROGRAM 블록은 \`programId\`를 쓴다. 해당하지 않는 필드는 생략하거나 null로 보낸다. GET 응답을 그대로 고쳐 보내도 된다. 모르는 필드는 422다.
- 생략하면 기본값: \`perVisit\`은 종류별로 POSTER 3, EVENT_BANNER 1, STORY 2. \`schedule\`은 ALWAYS, \`enabled\`는 true.
- 정보줄(\`settings.infoBar\`)과 PROGRAM 블록이 가리키는 운영 컨텐츠는 있어야 하고, 정보줄 칸은 그 운영 컨텐츠 종류가 들어갈 수 있는 칸이어야 한다. 칸과 종류는 GET /signage/program-types의 infoBarItem이 정한다(지금은 DDAY 칸에 DDAY 종류).`,
  })
  @ApiParam(ID_PARAM)
  @ApiBody({ schema: openApiOf(lineupInputSchema, 'input') })
  @ApiOkResponse({ type: LineupDto })
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description: 'version이 최신이 아님 (code CONFLICT). 다시 받아서 고친다',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      '입력 검증 실패. fields의 키는 점 경로다(예: blocks.2.durationSeconds, settings.infoBar.0.programId)',
    type: ErrorResponseDto,
  })
  replace(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodBody(lineupInputSchema)) input: LineupInput,
  ): Promise<LineupDto> {
    return this.lineupsService.replace(user, id, input);
  }
}
