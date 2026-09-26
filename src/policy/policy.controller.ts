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
import { SignageConfigDto } from './dto/signage-config.dto.js';
import { SIGNAGE_POLICY } from './signage-policy.js';

@ApiTags('Reference')
@ApiBearerAuth(BEARER_AUTH)
@Controller('signage/config')
export class PolicyController {
  @Get()
  @ApiOperation({
    summary: '운영 제한값',
    description:
      '업로드·신청 검증에 서버가 실제로 쓰는 값. 프론트는 상수 대신 이 값으로 폼을 미리 검증한다.',
  })
  @ApiOkResponse({ type: SignageConfigDto })
  @ApiUnauthorizedResponse({
    description: '로그인 필요',
    type: ErrorResponseDto,
  })
  getConfig(): SignageConfigDto {
    return {
      ...SIGNAGE_POLICY,
      allowedMimeTypes: [...SIGNAGE_POLICY.allowedMimeTypes],
      allowedDetailUrlHosts: [...SIGNAGE_POLICY.allowedDetailUrlHosts],
    };
  }
}
