import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotModifiedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import type { Device } from '../db/schema.js';
import { CurrentDevice, DeviceAuth } from '../devices/auth/device-auth.js';
import { PlaylistDto } from './dto/playlist.dto.js';
import { PlaylistService } from './playlist.service.js';

@ApiTags('Device runtime')
@Controller('signage/devices')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Get(':deviceId/playlist')
  @DeviceAuth()
  @ApiOperation({
    summary: '편성 조회',
    description: `TV가 \`refreshAfterSeconds\`마다 부른다. 지금 띄울 게시물만 준다.

- 승인됐고, 게시 기간 안이고, 이 기기가 대상인 게시물 (대상 그룹이 없는 게시물은 모든 기기)
- 중단·취소된 게시물은 다음 요청부터 빠진다
- 응답의 \`ETag\`(= \`"playlistVersion"\`)를 다음 요청의 \`If-None-Match\`로 보내면, 편성이 그대로일 때 **304**(본문 없음)를 준다`,
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
    type: PlaylistDto,
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
  async playlist(
    @CurrentDevice() device: Device,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlaylistDto> {
    const playlist = await this.playlistService.forDevice(device);
    // ETag를 미리 넣어 두면 Express가 If-None-Match와 비교해 같을 때 304로 바꿔 보낸다.
    res.setHeader('ETag', `"${playlist.playlistVersion}"`);
    // 캐시해도 되지만 매번 서버에 확인받는다(중단이 다음 요청에 반영되어야 한다).
    res.setHeader('Cache-Control', 'private, no-cache');
    return playlist;
  }
}
