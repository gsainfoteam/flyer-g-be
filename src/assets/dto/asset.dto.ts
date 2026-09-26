import { ApiProperty } from '@nestjs/swagger';
import {
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
} from '../../policy/signage-policy.js';

export class AssetVariantsDto {
  @ApiProperty({
    description: '목록 썸네일 (400x400 안)',
    example: 'https://cdn.example/assets/0f8e2c1a-.../thumb.webp',
  })
  thumb: string;

  @ApiProperty({
    description: '미리보기·검토 (1280x1280 안)',
    example: 'https://cdn.example/assets/0f8e2c1a-.../preview.webp',
  })
  preview: string;

  @ApiProperty({
    description: 'TV 재생 (1920x1080 안)',
    example: 'https://cdn.example/assets/0f8e2c1a-.../tv.webp',
  })
  tv: string;
}

export class AssetDto {
  @ApiProperty({ example: '0f8e2c1a-5b7d-4e21-9a0c-1d8e5f6b2c34' })
  assetId: string;

  @ApiProperty({
    description: '업로드 직후 미리보기에 그릴 URL. variants.preview와 같다',
    example: 'https://cdn.example/assets/0f8e2c1a-.../preview.webp',
  })
  url: string;

  @ApiProperty({
    description: '파일 내용으로 판별한 원본 형식',
    enum: ALLOWED_MIME_TYPES,
    example: 'image/jpeg',
  })
  mimeType: AllowedMimeType;

  @ApiProperty({
    description: '원본 가로(px, EXIF 회전 적용 후)',
    example: 1536,
  })
  width: number;

  @ApiProperty({
    description: '원본 세로(px, EXIF 회전 적용 후)',
    example: 2048,
  })
  height: number;

  @ApiProperty({ description: '원본 크기(바이트)', example: 2841221 })
  sizeBytes: number;

  @ApiProperty({
    description: '원본 내용의 sha256. 같은 asset이면 항상 같다',
    example:
      'sha256:9f2b5c0e3a1d4f6b8c7e9a0d1f2e3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c',
  })
  checksum: string;

  @ApiProperty({
    description:
      '자동 검사(형식·해상도·파일 무결성) 결과. 통과한 asset만 응답하므로 항상 APPROVED. 내용 검토는 신청 승인 단계에서 사람이 한다',
    enum: ['APPROVED'],
    example: 'APPROVED',
  })
  moderationStatus: 'APPROVED';

  @ApiProperty({
    description: 'EXIF(위치 정보 포함)를 제거한 webp 이미지',
    type: AssetVariantsDto,
  })
  variants: AssetVariantsDto;
}
