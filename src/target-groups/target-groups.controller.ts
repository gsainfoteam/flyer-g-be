import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { TargetGroupDto } from './dto/target-group.dto.js';
import { TargetGroupsService } from './target-groups.service.js';

@ApiTags('Reference')
@ApiBearerAuth(BEARER_AUTH)
@Controller('signage/target-groups')
export class TargetGroupsController {
  constructor(private readonly targetGroupsService: TargetGroupsService) {}

  @Get()
  @ApiOperation({
    summary: '대상 위치 그룹 목록',
    description:
      '신청 폼의 "대상 위치" 선택지. 노출 순서대로 준다. 신청의 targetGroupIds가 비어 있으면 전체 기기가 대상이다.',
  })
  @ApiOkResponse({ type: [TargetGroupDto] })
  @ApiUnauthorizedResponse({
    description: '로그인 필요',
    type: ErrorResponseDto,
  })
  findAll(): Promise<TargetGroupDto[]> {
    return this.targetGroupsService.findActive();
  }
}
