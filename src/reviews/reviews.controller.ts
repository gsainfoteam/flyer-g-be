import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { ApiPageResponse } from '../common/pagination/api-page-response.decorator.js';
import type { Page } from '../common/pagination/page.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { ReviewQueueQueryDto } from '../submissions/dto/submission-query.dto.js';
import {
  SubmissionDetailDto,
  SubmissionDto,
} from '../submissions/dto/submission.dto.js';
import { SubmissionsService } from '../submissions/submissions.service.js';
import {
  ApproveSubmissionDto,
  RejectSubmissionDto,
  ReviewDto,
  SuspendSubmissionDto,
} from './dto/review.dto.js';
import { ReviewsService } from './reviews.service.js';

const submissionIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppException(404, ErrorCode.NOT_FOUND, 'Submission not found'),
});

const ID_PARAM = { name: 'id', description: '신청 ID' };
const REVIEWER_ONLY = {
  description: 'REVIEWER·SUPER_ADMIN만 쓸 수 있다',
  type: ErrorResponseDto,
};
const NOT_FOUND_DOC = { description: '없는 신청', type: ErrorResponseDto };

@ApiTags('Reviews')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage')
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly submissionsService: SubmissionsService,
  ) {}

  @Get('reviews')
  @Roles('REVIEWER')
  @ApiOperation({
    summary: '검토 대기열',
    description:
      '오래 기다린 순(검토 요청 시각 오름차순). 대기 시간은 각 항목의 `submittedAt`과 응답의 `serverTime`으로 계산한다.',
  })
  @ApiPageResponse(SubmissionDto)
  @ApiForbiddenResponse(REVIEWER_ONLY)
  @ApiUnprocessableEntityResponse({
    description: '알 수 없는 상태, 잘못된 limit',
    type: ErrorResponseDto,
  })
  queue(@Query() query: ReviewQueueQueryDto): Promise<Page<SubmissionDto>> {
    return this.submissionsService.listReviewQueue(query);
  }

  @Post('submissions/:id/approve')
  @HttpCode(200)
  @Roles('REVIEWER')
  @Idempotent()
  @ApiOperation({
    summary: '승인',
    description: `검토 대기 중인 신청을 승인한다.

- 응답 상태는 시작 시각이 지났으면 \`PUBLISHED\`, 아니면 \`SCHEDULED\`다. 프론트는 계산하지 않고 이 값을 쓴다
- 승인한 포스터의 checksum을 검토 이력에 고정한다
- 게시 기간이 이미 끝난 신청은 승인할 수 없다(409). 기간 문제로 반려한다`,
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: SubmissionDetailDto })
  @ApiForbiddenResponse(REVIEWER_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description:
      'revision이 최신이 아님(다른 관리자가 먼저 처리했거나 신청자가 고침), 검토 대기가 아님, 기간이 끝남',
    type: ErrorResponseDto,
  })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', submissionIdPipe) id: string,
    @Body() dto: ApproveSubmissionDto,
  ): Promise<SubmissionDetailDto> {
    return this.reviewsService.approve(user, id, dto.revision);
  }

  @Post('submissions/:id/reject')
  @HttpCode(200)
  @Roles('REVIEWER')
  @ApiOperation({
    summary: '반려',
    description:
      '검토 대기 중인 신청을 반려한다. `comment`는 신청자에게 그대로 보인다. 신청자는 고친 뒤 재검토를 요청할 수 있다.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: SubmissionDetailDto })
  @ApiForbiddenResponse(REVIEWER_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description: 'revision이 최신이 아니거나 검토 대기가 아님',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '반려 사유 코드가 없거나 의견이 비어 있음 (fields)',
    type: ErrorResponseDto,
  })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', submissionIdPipe) id: string,
    @Body() dto: RejectSubmissionDto,
  ): Promise<SubmissionDetailDto> {
    return this.reviewsService.reject(
      user,
      id,
      dto.revision,
      dto.reasonCode,
      dto.comment,
    );
  }

  @Post('submissions/:id/suspend')
  @HttpCode(200)
  @Roles('REVIEWER')
  @ApiOperation({
    summary: '게시 중단',
    description: `승인된 게시(APPROVED·SCHEDULED·PUBLISHED, 기간이 끝나지 않은 것)를 내린다.

- 사유는 신청자에게 보이고, 검토 이력에 \`decision: SUSPENDED\`로 남는다
- 급하게 내리는 경우라 revision을 받지 않는다
- 기기에는 다음 편성 동기화 때 반영된다`,
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: SubmissionDetailDto })
  @ApiForbiddenResponse(REVIEWER_ONLY)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    description: '중단할 수 없는 상태이거나 이미 끝난 게시',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '사유가 비어 있음 (fields.reason)',
    type: ErrorResponseDto,
  })
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('id', submissionIdPipe) id: string,
    @Body() dto: SuspendSubmissionDto,
  ): Promise<SubmissionDetailDto> {
    return this.reviewsService.suspend(user, id, dto.reason);
  }

  @Get('submissions/:id/reviews')
  @ApiOperation({
    summary: '검토 이력',
    description:
      '승인·반려·중단 기록을 오래된 것부터 준다. 신청자 본인과 검토자만 볼 수 있다.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: [ReviewDto] })
  @ApiNotFoundResponse({
    description: '없는 신청이거나 볼 수 없는 신청',
    type: ErrorResponseDto,
  })
  history(
    @CurrentUser() user: AuthUser,
    @Param('id', submissionIdPipe) id: string,
  ): Promise<ReviewDto[]> {
    return this.reviewsService.history(user, id);
  }
}
