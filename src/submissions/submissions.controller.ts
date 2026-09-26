import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import type { AuthUser } from '../auth/types/auth-user.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { ApiPageResponse } from '../common/pagination/api-page-response.decorator.js';
import type { Page } from '../common/pagination/page.js';
import { BEARER_AUTH } from '../config/swagger.js';
import {
  CreateSubmissionDto,
  SubmissionVersionDto,
  UpdateSubmissionDto,
} from './dto/submission-input.dto.js';
import {
  ListSubmissionsQueryDto,
  SubmissionSummaryQueryDto,
} from './dto/submission-query.dto.js';
import {
  SubmissionDetailDto,
  SubmissionDto,
  SubmissionSummaryDto,
} from './dto/submission.dto.js';
import { SubmissionsService } from './submissions.service.js';

// 형식이 틀린 ID도 "없는 신청"으로 본다.
const submissionIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppException(404, ErrorCode.NOT_FOUND, 'Submission not found'),
});

const ID_PARAM = { name: 'id', description: '신청 ID' };
const NOT_FOUND_DOC = {
  description: '없는 신청이거나 볼 수 없는 신청',
  type: ErrorResponseDto,
};
const VALIDATION_DOC = {
  description:
    '입력 검증 실패 (VALIDATION_FAILED). fields에 필드별 문구: 제목, 카테고리, 포스터(assetId), 기간(startAt·endAt), 상세 링크, 대상 위치',
  type: ErrorResponseDto,
};

@ApiTags('Submissions')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage/submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post()
  @Idempotent()
  @ApiOperation({
    summary: '게시 신청',
    description: `신청을 만들고 바로 검토를 요청한다 (\`status: PENDING_REVIEW\`).

**검증** (기준은 \`GET /signage/config\`)
- 제목: 앞뒤 공백 제거 후 1~80자
- 포스터: 본인이 올려 complete까지 끝낸 asset
- 기간: 시작은 지금부터 24시간 이후, 종료는 시작보다 뒤, 최대 3개월(서울 달력)
- 상세 링크(선택): 허용된 호스트의 HTTPS. Ziggle 공지 주소(\`/notice/{id}\`)면 공지 ID를 뽑아 **공지 하나에 신청 하나**를 지킨다. 취소한 신청은 세지 않는다
- 대상 위치(선택): 숨기지 않은 그룹. 비우면 전체 기기`,
  })
  @ApiCreatedResponse({ type: SubmissionDetailDto })
  @ApiConflictResponse({
    description:
      '같은 공지로 이미 신청함 (ALREADY_SUBMITTED, fields.detailUrl). 반려된 신청은 새로 만들지 말고 수정 후 다시 제출한다',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse(VALIDATION_DOC)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSubmissionDto,
  ): Promise<SubmissionDetailDto> {
    return this.submissionsService.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: '신청 목록',
    description:
      '최신 신청부터. `statuses`를 비우면 ARCHIVED를 뺀 전체다. 표시 상태 판정은 응답의 `serverTime`으로 한다.',
  })
  @ApiPageResponse(SubmissionDto)
  @ApiForbiddenResponse({
    description: 'scope=all인데 검토자가 아님',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '알 수 없는 scope·status, 잘못된 limit',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSubmissionsQueryDto,
  ): Promise<Page<SubmissionDto>> {
    return this.submissionsService.list(user, query);
  }

  @Get('summary')
  @ApiOperation({
    summary: '운영 요약',
    description:
      '대시보드 수치. 목록을 세지 않고 서버가 한 번에 계산한다. 게시 중·예약·종료는 승인 건의 기간으로 판정하고, byStatus는 저장된 상태 그대로 센다.',
  })
  @ApiOkResponse({ type: SubmissionSummaryDto })
  @ApiForbiddenResponse({
    description: 'scope=all인데 검토자가 아님',
    type: ErrorResponseDto,
  })
  summary(
    @CurrentUser() user: AuthUser,
    @Query() query: SubmissionSummaryQueryDto,
  ): Promise<SubmissionSummaryDto> {
    return this.submissionsService.summary(user, query.scope);
  }

  @Get(':id')
  @ApiOperation({
    summary: '신청 상세',
    description: '신청자 본인과 검토자만 볼 수 있다.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: SubmissionDetailDto })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', submissionIdPipe) id: string,
  ): Promise<SubmissionDetailDto> {
    return this.submissionsService.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '신청 수정',
    description: `신청자 본인만 고친다. 보낸 필드 중 값이 실제로 바뀐 것만 반영한다. 선택 입력(상세 링크, 주최, 부제, 장소, 설명)은 null이나 빈 문자열이면 비운다.

| 현재 상태 | 수정 후 상태 |
|---|---|
| PENDING_REVIEW, REJECTED, DRAFT | 그대로 |
| APPROVED, SCHEDULED (게시 시작 전) | **PENDING_REVIEW** (재승인 필요) |
| 게시가 시작됐거나 그 외 상태 | 409 CONFLICT (중단은 운영자에게 요청) |

반려된 신청은 고친 뒤 \`POST /signage/submissions/{id}/submit\`으로 다시 검토를 요청한다.`,
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: SubmissionDetailDto })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description:
      'version이 최신이 아니거나 고칠 수 없는 상태 (CONFLICT), 바꾼 상세 링크의 공지로 이미 신청함 (ALREADY_SUBMITTED)',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse(VALIDATION_DOC)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', submissionIdPipe) id: string,
    @Body() dto: UpdateSubmissionDto,
  ): Promise<SubmissionDetailDto> {
    return this.submissionsService.update(user, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({
    summary: '재검토 요청',
    description:
      '반려(REJECTED)된 신청을 다시 검토 대기(PENDING_REVIEW)로 보낸다. 기간 규칙을 지금 시각으로 다시 검사한다.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: SubmissionDetailDto })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description: 'version이 최신이 아니거나 REJECTED·DRAFT가 아님',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '기간이 지금 기준으로 맞지 않음. 기간을 고친 뒤 다시 요청한다',
    type: ErrorResponseDto,
  })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', submissionIdPipe) id: string,
    @Body() dto: SubmissionVersionDto,
  ): Promise<SubmissionDetailDto> {
    return this.submissionsService.submit(user, id, dto.version);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: '신청 취소',
    description:
      '검토 대기·반려 건, 그리고 승인됐지만 게시 시작 전인 건을 취소한다. 취소한 공지는 다시 신청할 수 있다.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: SubmissionDetailDto })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description:
      'version이 최신이 아니거나 취소할 수 없는 상태. 이미 게시 중이면 운영자에게 중단을 요청한다',
    type: ErrorResponseDto,
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', submissionIdPipe) id: string,
    @Body() dto: SubmissionVersionDto,
  ): Promise<SubmissionDetailDto> {
    return this.submissionsService.cancel(user, id, dto.version);
  }
}
