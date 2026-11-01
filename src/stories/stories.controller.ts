import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { BEARER_AUTH } from '../config/swagger.js';
import {
  RecentStoriesDto,
  RecentStoriesQueryDto,
} from './dto/recent-stories.dto.js';
import { StoriesService } from './stories.service.js';

@ApiTags('Stories')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage/stories')
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Get('recent')
  @ApiOperation({
    summary: '최근 소식',
    description:
      '지금 게시 중인 소식 제보를 최근 승인 순으로 준다. 로그인한 사용자 누구나 부를 수 있다. 작성자와 신청 id는 싣지 않는다.',
  })
  @ApiOkResponse({ type: RecentStoriesDto })
  @ApiUnprocessableEntityResponse({
    description: '잘못된 limit',
    type: ErrorResponseDto,
  })
  recent(@Query() query: RecentStoriesQueryDto): Promise<RecentStoriesDto> {
    return this.storiesService.recent(query.limit);
  }
}
