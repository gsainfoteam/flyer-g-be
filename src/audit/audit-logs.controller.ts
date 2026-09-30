import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ApiPageResponse } from '../common/pagination/api-page-response.decorator.js';
import type { Page } from '../common/pagination/page.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { AuditLogsService } from './audit-logs.service.js';
import { AuditLogDto, ListAuditLogsQueryDto } from './dto/audit-log.dto.js';

@ApiTags('Audit logs')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({
    summary: '감사 로그',
    description: `누가 언제 무엇을 바꿨는지. 최신순이다.

- 검토자(REVIEWER·SUPER_ADMIN): 전체 로그. \`targetType\`·\`targetId\`·\`action\`으로 거를 수 있다. \`action\`은 쉼표로 여러 개를 보낼 수 있다
  - 사용자 역할 변경(\`targetType: USER\`) 로그는 SUPER_ADMIN만 본다. REVIEWER의 목록에서는 빠지고, \`targetType=USER\`로 요청하면 403
- 그 외 사용자: 본인 신청의 로그만 본다. \`targetType=SUBMISSION\`은 꼭 보내야 한다
  - \`targetId=<본인 신청 ID>\`: 그 신청의 로그 (신청 상세 화면)
  - \`targetId\`를 비우면: 본인 신청 전체의 로그 (홈 "최근 소식"). 기기 로그나 다른 사람 신청의 로그는 섞이지 않는다
  - \`action\` 필터는 함께 쓸 수 있다
- 주기 작업이 바꾼 상태는 \`actorType: SYSTEM\`으로 남는다`,
  })
  @ApiPageResponse(AuditLogDto)
  @ApiForbiddenResponse({
    description:
      '검토자가 아닌데 targetType=SUBMISSION 없이 요청했거나, 본인 신청이 아닌 targetId를 요청함. SUPER_ADMIN이 아닌데 targetType=USER를 요청함',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '알 수 없는 대상 종류·행위, 잘못된 limit',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<Page<AuditLogDto>> {
    return this.auditLogsService.list(user, query);
  }
}
