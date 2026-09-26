import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

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
}
