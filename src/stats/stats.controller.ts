import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { BEARER_AUTH } from '../config/swagger.js';
import {
  ImpressionStatsDto,
  ImpressionStatsQueryDto,
} from './dto/impressions.dto.js';
import { StatsService } from './stats.service.js';

@ApiTags('Stats')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage/stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('impressions')
  @ApiOperation({
    summary: '노출 통계',
    description: `기간 안의 게시물별 노출 수. 노출은 **디스플레이가 포스터를 정상 렌더링한 횟수**다(사람이 본 횟수가 아니다).

- 날짜는 서울 기준 하루 단위다. \`from\`·\`to\` 모두 포함
- 기본 기간은 오늘까지 30일, 최대 366일
- 집계는 10분마다 돈다. \`aggregatedAt\` 이후에 들어온 이벤트는 아직 반영되지 않았다
- 원본 이벤트는 90일 보관하지만 집계는 계속 남아 오래된 기간도 볼 수 있다`,
  })
  @ApiOkResponse({ type: ImpressionStatsDto })
  @ApiForbiddenResponse({
    description: 'scope=all인데 검토자가 아님',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      '날짜 형식이 틀리거나 없는 날짜, 시작이 끝보다 늦음, 366일 초과',
    type: ErrorResponseDto,
  })
  impressions(
    @CurrentUser() user: AuthUser,
    @Query() query: ImpressionStatsQueryDto,
  ): Promise<ImpressionStatsDto> {
    return this.statsService.impressions(user, query);
  }
}
