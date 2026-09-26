import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { AssetsService } from './assets.service.js';
import { AssetDto } from './dto/asset.dto.js';
import {
  PresignAssetRequestDto,
  PresignAssetResponseDto,
} from './dto/presign-asset.dto.js';

// 형식이 틀린 ID도 "없는 asset"으로 본다.
const assetIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppException(404, ErrorCode.NOT_FOUND, 'Asset not found'),
});

@ApiTags('Assets')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('presign')
  @ApiOperation({
    summary: '업로드 URL 발급',
    description: `포스터를 저장소에 직접 올릴 서명 URL을 발급한다.

**업로드 흐름**
1. 이 API로 \`assetId\`와 \`uploadUrl\`을 받는다
2. \`uploadUrl\`에 \`method\`(PUT)로 파일 본문을 보낸다. \`headers\`를 그대로 싣는다.
   Content-Type이나 파일 크기가 요청한 값과 다르면 저장소가 403으로 거절한다
3. \`POST /signage/assets/{assetId}/complete\`로 완료를 알리고 결과를 받는다

\`expiresAt\`(15분)이 지나면 1부터 다시 한다. 최대 크기와 허용 형식은 \`GET /signage/config\`와 같다.`,
  })
  @ApiCreatedResponse({ type: PresignAssetResponseDto })
  @ApiPayloadTooLargeResponse({
    description:
      '최대 용량 초과 (PAYLOAD_TOO_LARGE, fields.sizeBytes에 한도 안내)',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '입력 검증 실패 (허용하지 않는 형식 등)',
    type: ErrorResponseDto,
  })
  presign(
    @CurrentUser() user: AuthUser,
    @Body() dto: PresignAssetRequestDto,
  ): Promise<PresignAssetResponseDto> {
    return this.assetsService.presign(user.id, dto);
  }

  @Post(':assetId/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: '업로드 완료',
    description: `저장소에 올린 원본을 검증하고 공개용 이미지를 만든다.

- 파일 내용(시그니처)으로 형식을 판별한다. 확장자·Content-Type은 믿지 않는다
- JPEG·PNG·WebP만, 짧은 변 1080px 이상(EXIF 회전 적용 후), 움직이는 이미지 불가
- EXIF(위치 정보 포함)를 제거한 webp 변형 이미지(thumb, preview, tv)를 만들고 원본은 지운다
- 여러 번 불러도 결과가 같다. 이미 처리된 asset은 같은 응답(또는 같은 거절 사유)을 준다
- 거절된 asset은 다시 쓸 수 없다. presign부터 새로 한다`,
  })
  @ApiParam({ name: 'assetId', description: 'presign 응답의 assetId' })
  @ApiOkResponse({ type: AssetDto })
  @ApiBadRequestResponse({
    description:
      '아직 파일을 올리지 않았다 (INVALID_REQUEST). 업로드 후 다시 부른다',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: '없는 asset이거나 남의 asset',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      '이미지 거절 (VALIDATION_FAILED). fields.file에 사용자에게 보여 줄 사유 (예: "짧은 변이 1080px 이상이어야 합니다. (현재 800px)")',
    type: ErrorResponseDto,
  })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('assetId', assetIdPipe) assetId: string,
  ): Promise<AssetDto> {
    return this.assetsService.complete(user.id, assetId);
  }
}
