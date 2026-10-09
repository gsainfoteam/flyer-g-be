import { ApiProperty } from '@nestjs/swagger';
import { DeviceLayoutDto } from '../../devices/dto/device.dto.js';

/** 영상 포스터 재생 정보 */
export class PlaylistVideoDto {
  @ApiProperty({
    description:
      'TV 재생용 mp4 (H.264·AAC, 1920x1080 안, 30fps 이하, faststart). fetch()로 읽을 수 있어야 한다(버킷 CORS에 GET 필요). 내용이 바뀌지 않으므로 checksum으로 캐시한다',
    example:
      'https://gsainfoteam-icarus-flyer-g-production.s3.ap-northeast-2.amazonaws.com/assets/0f8e2c1a-.../video.mp4',
  })
  url: string;

  @ApiProperty({
    description:
      '소리 트랙이 있는지. 브라우저 자동재생은 음소거여야 하므로 소리를 낼지는 플레이어가 정한다',
    example: true,
  })
  hasAudio: boolean;
}

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
    description: '포스터 종류. VIDEO면 video를 재생한다',
    enum: ['IMAGE', 'VIDEO'],
    example: 'IMAGE',
  })
  kind: 'IMAGE' | 'VIDEO';

  @ApiProperty({
    description:
      '원본 가로(px, EXIF·영상 회전 정보 적용 후). assetUrl 이미지와 비율이 같으므로 이미지를 받기 전에 배치를 정하는 데 쓴다',
    example: 1536,
  })
  width: number;

  @ApiProperty({
    description: '원본 세로(px, EXIF·영상 회전 정보 적용 후)',
    example: 2048,
  })
  height: number;

  @ApiProperty({
    description: '영상 길이(ms). 이미지는 null',
    type: Number,
    nullable: true,
    example: null,
  })
  durationMs: number | null;

  @ApiProperty({
    description:
      'TV용 포스터(1920x1080 안, webp). fetch()로 읽을 수 있어야 한다(버킷 CORS에 GET 필요). 영상이어도 항상 정지 이미지(대표 프레임)다. 영상을 모르는 플레이어는 이것만 띄우면 된다',
    example:
      'https://gsainfoteam-icarus-flyer-g-production.s3.ap-northeast-2.amazonaws.com/assets/0f8e2c1a-.../tv.webp',
  })
  assetUrl: string;

  @ApiProperty({
    description: `영상 포스터만. 이미지는 null.

재생 규칙
- SINGLE: 끝까지 한 번 재생하고 다음으로 넘긴다. rotationSeconds보다 짧으면 그 시간이 찰 때까지 반복한다
- FOUR_GRID: 칸 안에서 음소거로 반복 재생한다. 전환은 rotationSeconds를 따른다
- 영상을 받는 중이거나 재생에 실패하면 assetUrl(대표 프레임)을 띄운다`,
    type: PlaylistVideoDto,
    nullable: true,
  })
  video: PlaylistVideoDto | null;

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
      '편성 내용(항목, 기기 이름, 기기 화면 설정)의 해시. 같으면 내용이 같다. ETag 헤더와 같은 값이다',
    example: '9f2b5c0e3a1d4f6b',
  })
  playlistVersion: string;

  @ApiProperty({
    description: '기기 이름. 관리자가 바꾸면 다음 편성에 반영된다',
    example: 'A동 로비 TV',
  })
  deviceName: string;

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
