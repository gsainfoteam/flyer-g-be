import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiNotModifiedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { BEARER_AUTH } from '../config/swagger.js';
import type { Device } from '../db/schema.js';
import { CurrentDevice, DeviceAuth } from '../devices/auth/device-auth.js';
import { PlaylistProgramDto, PlaylistV2Dto } from './dto/playlist-v2.dto.js';
import { PlaylistDto } from './dto/playlist.dto.js';
import { PlaylistService } from './playlist.service.js';

export class PlaylistQueryDto {
  @ApiPropertyOptional({
    description:
      '응답 버전. 2면 그룹 편성과 모든 신청 종류를 싣는 v2, 없거나 1이면 포스터만 싣는 v1 (한동안 유지)',
    enum: ['1', '2'],
  })
  @IsOptional()
  @IsIn(['1', '2'], { message: 'v는 1 또는 2여야 합니다.' })
  v?: '1' | '2';
}

const deviceIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new AppException(404, ErrorCode.NOT_FOUND, 'Device not found'),
});

@ApiTags('Device runtime')
@ApiExtraModels(PlaylistDto, PlaylistV2Dto, PlaylistProgramDto)
@Controller('signage/devices')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Get(':deviceId/playlist')
  @DeviceAuth()
  @ApiOperation({
    summary: '편성 조회',
    description: `TV가 \`refreshAfterSeconds\`마다 부른다. 지금 띄울 게시물만 준다. \`?v=2\`면 v2(PlaylistV2Dto), 아니면 v1(PlaylistDto)이다.

- 승인됐고, 게시 기간 안이고, 이 기기가 대상인 게시물 (대상 그룹이 없는 게시물은 모든 기기)
- 중단·취소된 게시물은 다음 요청부터 빠진다
- 응답의 \`ETag\`(= \`"playlistVersion"\`)를 다음 요청의 \`If-None-Match\`로 보내면, 편성이 그대로일 때 **304**(본문 없음)를 준다

v2
- 편성 그룹의 편성에 기기 예외를 덮은 \`settings\`·\`blocks\`(꺼진 블록은 뺀다)
- \`submissions\`: 종류별(POSTER·EVENT_BANNER·STORY) 게시 중인 신청. 제보에는 작성자가 없다
- \`programs\`: 블록과 정보줄이 가리키는 운영 컨텐츠
- \`live\`: 지금 띄울 라이브(기기 값, 없으면 그룹 값). 라이브가 띄우는 신청은 이 기기 대상이 아니어도 실린다
- \`playlistVersion\`은 serverTime을 뺀 v2 응답 전체의 해시다`,
  })
  @ApiParam({
    name: 'deviceId',
    description: '기기 ID (토큰의 기기와 같아야 한다)',
  })
  @ApiHeader({
    name: 'If-None-Match',
    required: false,
    description: '이전 응답의 ETag. 예: "9f2b5c0e3a1d4f6b"',
  })
  @ApiOkResponse({
    description: 'v=2면 PlaylistV2Dto, 아니면 PlaylistDto',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(PlaylistDto) },
        { $ref: getSchemaPath(PlaylistV2Dto) },
      ],
    },
    headers: {
      ETag: { description: '"playlistVersion" (따옴표 포함)' },
    },
  })
  @ApiNotModifiedResponse({
    description: '편성이 바뀌지 않았다. 캐시한 편성을 계속 재생한다',
  })
  @ApiUnauthorizedResponse({
    description: '기기 토큰이 없거나 틀림, 비활성 기기',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: '경로의 deviceId가 토큰의 기기와 다름',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'v가 1·2가 아님',
    type: ErrorResponseDto,
  })
  async playlist(
    @CurrentDevice() device: Device,
    @Query() query: PlaylistQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlaylistDto | PlaylistV2Dto> {
    const playlist =
      query.v === '2'
        ? await this.playlistService.forDeviceV2(device)
        : await this.playlistService.forDevice(device);
    // ETag를 미리 넣어 두면 Express가 If-None-Match와 비교해 같을 때 304로 바꿔 보낸다.
    res.setHeader('ETag', `"${playlist.playlistVersion}"`);
    // 캐시해도 되지만 매번 서버에 확인받는다(중단이 다음 요청에 반영되어야 한다).
    res.setHeader('Cache-Control', 'private, no-cache');
    return playlist;
  }
}

/** 운영자가 기기 편성을 미리 본다. 기기 토큰 경로와 가드를 섞지 않으려고 경로를 나눴다 */
@ApiTags('Devices')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: '로그인 필요', type: ErrorResponseDto })
@Controller('signage/devices')
export class PlaylistPreviewController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Get(':id/playlist-preview')
  @Roles('REVIEWER')
  @ApiOperation({
    summary: '기기 편성 미리보기',
    description: `기기가 지금 받을 편성 v2(\`?v=2\`)와 같은 결과를 준다. 검토자 이상 (FE 7-4).

부작용이 없다: lastSeenAt·heartbeat·온라인 판정을 바꾸지 않는다. 304 흐름이 없도록 기기용 ETag(playlistVersion)를 주지 않고 \`Cache-Control: no-store\`로 준다. 비활성 기기도 볼 수 있다.
\`playlistVersion\`은 기기가 받을 값과 같으므로 기기의 lastPlaylistVersion과 비교해 동기화를 확인할 수 있다.`,
  })
  @ApiParam({ name: 'id', description: '기기 ID' })
  @ApiOkResponse({ type: PlaylistV2Dto })
  @ApiForbiddenResponse({
    description: 'REVIEWER·SUPER_ADMIN만 볼 수 있다',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: '없는 기기', type: ErrorResponseDto })
  preview(
    @Param('id', deviceIdPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlaylistV2Dto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.playlistService.preview(id);
  }
}
