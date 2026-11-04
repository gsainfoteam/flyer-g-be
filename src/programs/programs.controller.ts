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
  ApiBody,
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
import { openApiOf, ZodBody } from '../common/validation/zod.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { ProgramDto, ProgramTypeDto } from './dto/program.dto.js';
import {
  createProgramSchema,
  updateProgramSchema,
  type CreateProgramInput,
  type UpdateProgramInput,
} from './program-schema.js';
import { PROGRAM_TYPE_NAMES } from './program-types.js';
import { ProgramsService } from './programs.service.js';

const ID_PARAM = {
  name: 'id',
  description: '운영 컨텐츠 ID',
  example: 'prg_3f9a1c2b7d4e',
};
const SUPER_ADMIN_ONLY = {
  description: 'SUPER_ADMIN만 쓸 수 있다',
  type: ErrorResponseDto,
};
const NOT_FOUND_DOC = {
  description: '없는 운영 컨텐츠',
  type: ErrorResponseDto,
};
const VALIDATION_DOC = {
  description:
    '입력 검증 실패. fields 키는 점 경로다(예: name, type, params.date, params.rounds). 종류의 paramsSchema에 없는 키는 그 키 이름을 알려 준다',
  type: ErrorResponseDto,
};

/** 운영 컨텐츠(D-day·일진·클릭 배틀…). 편성 블록과 정보줄이 가리킨다. 모두 SUPER_ADMIN */
@ApiTags('Programs')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@ApiForbiddenResponse(SUPER_ADMIN_ONLY)
@Controller('signage')
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Get('program-types')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '운영 컨텐츠 종류',
    description: `관리 화면 폼의 원천. 종류는 서버 코드에 정의되어 있고, 새 종류는 서버 배포로 더한다.
지금 종류: ${PROGRAM_TYPE_NAMES.join(', ')}. 정보줄 칸(infoBarItem)도 여기서 정한다`,
  })
  @ApiOkResponse({ type: [ProgramTypeDto] })
  types(): ProgramTypeDto[] {
    return this.programsService.types();
  }

  @Get('programs')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '운영 컨텐츠 목록',
    description: '이름순. 쓰는 그룹·기기(usedBy)와 데이터 상태를 같이 준다',
  })
  @ApiOkResponse({ type: [ProgramDto] })
  list(): Promise<ProgramDto[]> {
    return this.programsService.list();
  }

  @Get('programs/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '운영 컨텐츠 상세' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ProgramDto })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  findOne(@Param('id') id: string): Promise<ProgramDto> {
    return this.programsService.findOne(id);
  }

  @Post('programs')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '운영 컨텐츠 만들기',
    description:
      'params는 그 종류의 paramsSchema로 검증한다. id는 서버가 prg_xxx로 발급한다. 감사 로그 PROGRAM_CREATED',
  })
  @ApiBody({ schema: openApiOf(createProgramSchema, 'input') })
  @ApiCreatedResponse({ type: ProgramDto })
  @ApiUnprocessableEntityResponse(VALIDATION_DOC)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(createProgramSchema)) input: CreateProgramInput,
  ): Promise<ProgramDto> {
    return this.programsService.create(user, input);
  }

  @Patch('programs/:id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '운영 컨텐츠 고치기',
    description: `보낸 필드만 바꾼다. 종류(type)는 바꿀 수 없다. 감사 로그 PROGRAM_UPDATED
- params는 통째로 바꾸고 그 종류의 paramsSchema로 검증한다
- 이것을 쓰는 그룹·기기와, 라이브 SHOW로 띄운 TV에 program-changed를 보낸다`,
  })
  @ApiParam(ID_PARAM)
  @ApiBody({ schema: openApiOf(updateProgramSchema, 'input') })
  @ApiOkResponse({ type: ProgramDto })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiUnprocessableEntityResponse(VALIDATION_DOC)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodBody(updateProgramSchema)) input: UpdateProgramInput,
  ): Promise<ProgramDto> {
    return this.programsService.update(user, id, input);
  }

  @Delete('programs/:id')
  @HttpCode(204)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '운영 컨텐츠 지우기',
    description: `편성 블록, 그룹 정보줄, 기기 예외 정보줄 중 하나라도 가리키면 409 IN_USE다. 먼저 그쪽에서 뺀다.
라이브 SHOW가 가리키는 것은 막지 않는다. 지우면 그 라이브의 main이 편성 응답에서 null이 된다. 감사 로그 PROGRAM_DELETED`,
  })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: '지움' })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description:
      '쓰는 곳이 있음 (code IN_USE). details: { usedByGroupIds: 편성 블록이나 그룹 정보줄이 가리키는 그룹, usedByDeviceIds: 기기 예외 정보줄이 가리키는 기기 }',
    type: ErrorResponseDto,
  })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.programsService.remove(user, id);
  }
}
