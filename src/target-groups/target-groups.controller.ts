import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { BEARER_AUTH } from '../config/swagger.js';
import {
  CreateTargetGroupDto,
  UpdateTargetGroupDto,
} from './dto/target-group-input.dto.js';
import { TargetGroupDto } from './dto/target-group.dto.js';
import { TargetGroupsService } from './target-groups.service.js';

const ID_PARAM = { name: 'id', description: '그룹 ID', example: 'grp_house_a' };
const NOT_FOUND_DOC = { description: '없는 그룹', type: ErrorResponseDto };
const SUPER_ADMIN_ONLY = {
  description: 'SUPER_ADMIN만 쓸 수 있다',
  type: ErrorResponseDto,
};
const NAME_VALIDATION_DOC = {
  description:
    '이름 검증 실패: 비었거나 40자 초과, 대소문자를 무시하고 다른 그룹(숨긴 그룹 포함)과 중복. 모두 fields.name',
  type: ErrorResponseDto,
};

/** 기기·신청의 대상 위치 그룹. 조회는 로그인한 누구나, 변경은 SUPER_ADMIN만 한다. */
@ApiTags('Reference')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage/target-groups')
export class TargetGroupsController {
  constructor(private readonly targetGroupsService: TargetGroupsService) {}

  @Get()
  @ApiOperation({
    summary: '대상 위치 그룹 목록',
    description: `신청 폼의 "대상 위치"와 기기 폼의 "위치 그룹" 선택지. 이름순으로 준다.
신청의 targetGroupIds가 비어 있으면 전체 기기가 대상이다.

**숨긴 그룹(isHidden: true)도 준다.** 과거 신청·기기의 그룹 ID를 이름으로 바꿔 보여 줄 때 필요하다.
새로 고르는 선택 목록에서는 프론트가 숨긴 그룹을 빼야 한다. 숨긴 그룹을 새로 추가하면 422다.`,
  })
  @ApiOkResponse({ type: [TargetGroupDto] })
  findAll(): Promise<TargetGroupDto[]> {
    return this.targetGroupsService.findAll();
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '대상 위치 그룹 추가',
    description:
      'ID는 서버가 정한다(grp_xxx). 새 그룹은 숨기지 않은 상태, deviceCount 0으로 만들어진다. 기본 편성(기본 설정과 포스터 블록 하나)이 같이 생긴다. 감사 로그 GROUP_CREATED',
  })
  @ApiCreatedResponse({ type: TargetGroupDto })
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiUnprocessableEntityResponse(NAME_VALIDATION_DOC)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTargetGroupDto,
  ): Promise<TargetGroupDto> {
    return this.targetGroupsService.create(user, dto);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '대상 위치 그룹 수정 (이름 변경·숨김)',
    description: `보낸 필드만 바꾼다. 실제로 바뀐 필드가 있을 때만 감사 로그 GROUP_UPDATED를 남긴다.

숨김(\`isHidden: true\`)은 쓰는 곳이 있어도 된다. 기기·신청에 새로 추가하는 것만 막히고,
이미 연결된 기기·신청과 편성 대상 판정은 그대로다. \`isHidden: false\`로 다시 보이게 할 수 있다.`,
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: TargetGroupDto })
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiUnprocessableEntityResponse(NAME_VALIDATION_DOC)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTargetGroupDto,
  ): Promise<TargetGroupDto> {
    return this.targetGroupsService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '대상 위치 그룹 삭제',
    description: `오타로 만든 그룹을 지우는 용도. 어떤 기기의 groupIds에도, 어떤 신청의 targetGroupIds에도
(취소·종료된 신청 포함) 들어 있지 않고, 이 그룹 편성을 따르는 기기도 없어야 지울 수 있다.
쓰는 곳이 있으면 409 \`IN_USE\`이고, 그때는 숨김을 쓴다. 그룹 편성은 그룹과 같이 지워진다.
감사 로그 GROUP_DELETED`,
  })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: '삭제됨' })
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description:
      '기기나 신청이 쓰고 있는 그룹 (code IN_USE). details: { deviceIds: 그룹에 속하거나 이 그룹 편성을 따르는 기기 ID, submissionCount: 이 그룹을 대상으로 고른 신청 수(끝난 신청 포함) }',
    type: ErrorResponseDto,
  })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.targetGroupsService.remove(user, id);
  }
}
