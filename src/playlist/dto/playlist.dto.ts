import { ApiProperty } from '@nestjs/swagger';
import { DeviceLayoutDto } from '../../devices/dto/device.dto.js';

/** 편성 항목 하나 (요구사항 8절) */
export class PlaylistItemDto {
  @ApiProperty({ example: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34' })
  submissionId: string;

  @ApiProperty({
    description: '신청 version. 내용이 바뀌면 오른다',
    example: 3,
  })
  revision: number;

  @ApiProperty({ example: '겨울 정기 공연 〈한밤의 물리학〉' })
  title: string;

  @ApiProperty({ description: '카테고리 표시 이름', example: '공연' })
  category: string;

  @ApiProperty({
    description:
      'TV용 포스터(1920x1080 안, webp). fetch()로 읽을 수 있어야 한다(버킷 CORS에 GET 필요)',
    example:
      'https://gsainfoteam-icarus-flyer-g-production.s3.ap-northeast-2.amazonaws.com/assets/0f8e2c1a-.../tv.webp',
  })
  assetUrl: string;

  @ApiProperty({
    description: '상세 링크(QR). 없으면 null',
    type: String,
    nullable: true,
    example: 'https://ziggle.gistory.me/notice/1041',
  })
  detailUrl: string | null;

  @ApiProperty({ example: '2026-07-30T00:00:00.000Z' })
  startsAt: string;

  @ApiProperty({ example: '2026-08-06T14:59:59.000Z' })
  endsAt: string;

  @ApiProperty({ description: '높을수록 앞에 온다', example: 0 })
  priority: number;

  @ApiProperty({
    description:
      '포스터 내용의 sha256. 미디어 캐시 key다. 내용이 같으면 항상 같고, 다르면 반드시 다르다',
    example:
      'sha256:9f2b5c0e3a1d4f6b8c7e9a0d1f2e3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c',
  })
  checksum: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '12월 셋째 주 금요일 저녁',
  })
  subtitle: string | null;

  @ApiProperty({ type: String, nullable: true, example: '대강당' })
  location: string | null;

  @ApiProperty({
    description: '주최 (신청의 organizerName)',
    type: String,
    nullable: true,
    example: '공연동아리 페이드인',
  })
  organizerName: string | null;
}

export class PlaylistDto {
  @ApiProperty({
    description:
      '서버 현재 시각. 게시 기간 판정과 오프라인 시각 보정의 기준이다',
    example: '2026-07-29T06:30:00.000Z',
  })
  serverTime: string;

  @ApiProperty({
    description:
      '편성 내용(항목과 기기 화면 설정)의 해시. 같으면 내용이 같다. ETag 헤더와 같은 값이다',
    example: '9f2b5c0e3a1d4f6b',
  })
  playlistVersion: string;

  @ApiProperty({
    description: '다음 편성 요청까지 기다릴 시간(초)',
    example: 60,
  })
  refreshAfterSeconds: number;

  @ApiProperty({ type: DeviceLayoutDto })
  layout: DeviceLayoutDto;

  @ApiProperty({
    description:
      '지금 띄울 게시물. 우선순위 높은 순, 같으면 시작이 이른 순. 없으면 빈 배열(오류 아님)',
    type: [PlaylistItemDto],
  })
  items: PlaylistItemDto[];
}
