import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
} from '../../policy/signage-policy.js';

export class PresignAssetRequestDto {
  @ApiProperty({
    description: '원본 파일 이름 (표시·로그용)',
    example: 'poster.jpg',
  })
  @IsString({ message: '파일 이름이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '파일 이름이 올바르지 않습니다.' })
  @MaxLength(255, { message: '파일 이름은 255자 이하여야 합니다.' })
  fileName: string;

  @ApiProperty({
    description:
      '브라우저가 판별한 파일 형식. 업로드할 때 이 값을 Content-Type으로 보내야 한다',
    enum: ALLOWED_MIME_TYPES,
    example: 'image/jpeg',
  })
  @IsIn(ALLOWED_MIME_TYPES, {
    message: 'JPEG, PNG, WebP 파일만 올릴 수 있습니다.',
  })
  mimeType: AllowedMimeType;

  @ApiProperty({
    description: '파일 크기(바이트). 업로드할 파일의 크기와 정확히 같아야 한다',
    example: 3145728,
  })
  @IsInt({ message: '파일 크기가 올바르지 않습니다.' })
  @Min(1, { message: '빈 파일은 올릴 수 없습니다.' })
  sizeBytes: number;

  @ApiPropertyOptional({
    description:
      '파일 내용의 sha256. 보내면 완료 처리 때 대조해 전송 중 손상을 잡는다',
    example:
      'sha256:9f2b5c0e3a1d4f6b8c7e9a0d1f2e3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c',
  })
  @IsOptional()
  @Matches(/^sha256:[0-9a-f]{64}$/, {
    message: 'checksum은 sha256:<소문자 hex 64자> 형식이어야 합니다.',
  })
  checksum?: string;
}

export class PresignAssetResponseDto {
  @ApiProperty({
    description: '완료 처리와 신청 생성에 쓰는 ID',
    example: '0f8e2c1a-5b7d-4e21-9a0c-1d8e5f6b2c34',
  })
  assetId: string;

  @ApiProperty({
    description:
      '브라우저가 파일을 직접 올릴 서명 URL. 우리 API 서버가 아니라 저장소 주소다',
    example:
      'https://storage.example/flyer-g/uploads/0f8e2c1a-...?X-Amz-Signature=...',
  })
  uploadUrl: string;

  @ApiProperty({ enum: ['PUT'], example: 'PUT' })
  method: 'PUT';

  @ApiProperty({
    description:
      '업로드 요청에 그대로 실어야 하는 헤더. 다르면 저장소가 서명 불일치로 거절한다',
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'Content-Type': 'image/jpeg' },
  })
  headers: Record<string, string>;

  @ApiProperty({
    description: 'uploadUrl 만료 시각. 지나면 presign부터 다시 한다',
    example: '2026-07-29T06:45:00.000Z',
  })
  expiresAt: string;
}
