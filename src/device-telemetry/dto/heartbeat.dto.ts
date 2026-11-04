import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NowPlayingDto } from '../../devices/dto/now-playing.dto.js';

const WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

export class ResolutionInputDto {
  @ApiProperty({ example: 1920 })
  @IsInt()
  @Min(1)
  @Max(16384)
  width: number;

  @ApiProperty({ example: 1080 })
  @IsInt()
  @Min(1)
  @Max(16384)
  height: number;
}

/** 요구사항 9.1. 개인정보·화면 캡처·사용자 행동은 받지 않는다(FR-PLY-08). */
export class HeartbeatDto {
  @ApiProperty({ description: '플레이어 앱 버전', example: '0.4.2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  appVersion: string;

  @ApiPropertyOptional({
    description: '지금 재생 중인 편성의 playlistVersion. 첫 로드 전이면 null',
    type: String,
    nullable: true,
    example: '9f2b5c0e3a1d4f6b',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  playlistVersion?: string | null;

  @ApiPropertyOptional({
    description:
      '마지막으로 포스터를 정상 렌더링한 시각(기기 시계). 아직 렌더 전이면 null',
    type: String,
    nullable: true,
    example: '2026-07-29T06:29:50.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(WITH_OFFSET)
  lastRenderOkAt?: string | null;

  @ApiProperty({ type: ResolutionInputDto })
  @ValidateNested()
  @Type(() => ResolutionInputDto)
  resolution: ResolutionInputDto;

  @ApiPropertyOptional({
    description:
      '지금 장면. 서버는 마지막 값을 기기 응답의 now에 그대로 싣는다. 보내지 않으면(옛 플레이어) null로 둔다. 형식이 틀리면 heartbeat 전체가 422이므로 주의한다',
    type: NowPlayingDto,
    nullable: true,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsObject({ message: '지금 장면이 올바르지 않습니다.' })
  @ValidateNested()
  @Type(() => NowPlayingDto)
  now?: NowPlayingDto | null;
}
