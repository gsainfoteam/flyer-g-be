import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import { validationFailed } from '../common/errors/validation.js';
import { ApiPageResponse } from '../common/pagination/api-page-response.decorator.js';
import type { Page } from '../common/pagination/page.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { grantedRoleEnum, type GrantedRole } from '../db/schema.js';
import { AdminUserDto, ListUsersQueryDto } from './dto/admin-user.dto.js';
import { UserRolesService } from './user-roles.service.js';

const userIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppException(404, ErrorCode.NOT_FOUND, 'User not found'),
});

// SUBMITTER는 로그인한 모두가 가지는 역할이라 부여·회수 대상이 아니다.
const rolePipe = new ParseEnumPipe(
  Object.fromEntries(grantedRoleEnum.enumValues.map((role) => [role, role])),
  {
    exceptionFactory: () =>
      validationFailed({ role: '부여할 수 없는 역할입니다.' }),
  },
);

const ID_PARAM = { name: 'id', description: '사용자 ID' };
const ROLE_PARAM = {
  name: 'role',
  description: '역할. SUBMITTER는 모두가 가지므로 부여·회수할 수 없다',
  enum: grantedRoleEnum.enumValues,
};
const SUPER_ADMIN_ONLY = {
  description: 'SUPER_ADMIN만 쓸 수 있다',
  type: ErrorResponseDto,
};
const NOT_FOUND_DOC = {
  description: '없는 사용자 (로그인한 적 없는 사람 포함)',
  type: ErrorResponseDto,
};
const ROLE_VALIDATION_DOC = {
  description: 'REVIEWER·SUPER_ADMIN이 아닌 역할 (fields.role)',
  type: ErrorResponseDto,
};

/**
 * SUPER_ADMIN이 사용자 역할을 부여·회수한다. 첫 SUPER_ADMIN만 DB에 직접 넣는다.
 * 모든 변경은 감사 로그(USER_ROLE_GRANTED·USER_ROLE_REVOKED)에 남는다.
 */
@ApiTags('Users')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Roles('SUPER_ADMIN')
@Controller('signage/users')
export class UsersController {
  constructor(private readonly userRolesService: UserRolesService) {}

  @Get()
  @ApiOperation({
    summary: '사용자 목록 (역할 관리)',
    description: `이름순. 역할을 줄 사람을 찾을 때 쓴다.
사용자는 첫 로그인 때 만들어지므로, 한 번도 로그인하지 않은 사람은 목록에 없고 역할도 줄 수 없다.`,
  })
  @ApiPageResponse(AdminUserDto)
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiUnprocessableEntityResponse({
    description: '검색어가 너무 김, 알 수 없는 역할, 잘못된 limit',
    type: ErrorResponseDto,
  })
  list(@Query() query: ListUsersQueryDto): Promise<Page<AdminUserDto>> {
    return this.userRolesService.list(query);
  }

  @Put(':id/roles/:role')
  @ApiOperation({
    summary: '역할 부여',
    description: `이미 가진 역할이면 아무것도 바꾸지 않는다(감사 로그도 없음). 새로 부여하면 감사 로그 USER_ROLE_GRANTED.
대상의 다음 요청부터 바로 적용된다. 대상 화면의 메뉴는 세션(GET /auth/session)을 다시 불러와야 바뀐다.
SUPER_ADMIN도 부여할 수 있다.`,
  })
  @ApiParam(ID_PARAM)
  @ApiParam(ROLE_PARAM)
  @ApiOkResponse({ description: '부여 후의 사용자', type: AdminUserDto })
  @ApiForbiddenResponse(SUPER_ADMIN_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiUnprocessableEntityResponse(ROLE_VALIDATION_DOC)
  grant(
    @CurrentUser() user: AuthUser,
    @Param('id', userIdPipe) id: string,
    @Param('role', rolePipe) role: GrantedRole,
  ): Promise<AdminUserDto> {
    return this.userRolesService.grant(user, id, role);
  }

  @Delete(':id/roles/:role')
  @HttpCode(204)
  @ApiOperation({
    summary: '역할 회수',
    description: `없는 역할이면 아무것도 바꾸지 않는다(감사 로그도 없음). 회수하면 감사 로그 USER_ROLE_REVOKED.
대상의 다음 요청부터 바로 권한이 없어진다.

**본인의 역할은 회수할 수 없다(403).** 다른 SUPER_ADMIN이 회수해야 한다.
그래서 SUPER_ADMIN이 한 명도 남지 않는 일은 없다. 두 관리자가 동시에 서로를 회수하면 먼저 처리된 쪽만 성공하고,
다른 쪽은 이미 SUPER_ADMIN이 아니어서 403이다.`,
  })
  @ApiParam(ID_PARAM)
  @ApiParam(ROLE_PARAM)
  @ApiNoContentResponse({ description: '회수됨 (원래 없던 역할이어도 204)' })
  @ApiForbiddenResponse({
    description:
      'SUPER_ADMIN이 아님(처리 도중 다른 관리자에게 회수된 경우 포함), 또는 본인의 역할을 회수하려 함',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description:
      '마지막 SUPER_ADMIN을 회수하려 함 (code CONFLICT). 위 규칙상 일어나지 않지만 안전장치로 막는다',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse(ROLE_VALIDATION_DOC)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', userIdPipe) id: string,
    @Param('role', rolePipe) role: GrantedRole,
  ): Promise<void> {
    return this.userRolesService.revoke(user, id, role);
  }
}
