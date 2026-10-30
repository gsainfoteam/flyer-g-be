/**
 * 게시 운영 정책의 단일 원천. 서버 검증과 GET /signage/config가 같은 값을 쓴다.
 * 프론트가 이 값을 받아 폼에서 미리 막으므로 "올릴 수 있다고 했는데 거절당하는" 일이 없다.
 *
 * 배포 환경마다 달라질 값이 아니라 제품 정책이므로 환경변수가 아니라 코드에 둔다.
 * 바꿀 때는 PR로 바꾸고 프론트에도 알린다.
 * 영상 업로드를 여는 스위치(VIDEO_UPLOADS_ENABLED)만 예외다. TV 플레이어가 준비된 환경부터 차례로 연다.
 */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;

/** presign이 알아보는 모든 형식. 실제로 받는지는 allowedMimeTypes()가 정한다 */
export const ASSET_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export type VideoMimeType = (typeof VIDEO_MIME_TYPES)[number];
export type AssetMimeType = (typeof ASSET_MIME_TYPES)[number];
export type MediaKind = 'IMAGE' | 'VIDEO';

export const SIGNAGE_POLICY = {
  /** 이미지 최대 용량(바이트) */
  maxUploadBytes: 10 * 1024 * 1024,
  /** 영상 최대 용량(바이트) */
  maxVideoUploadBytes: 100 * 1024 * 1024,
  /** 영상 최대 길이(초) */
  maxVideoDurationSeconds: 30,
  /** 제목 최대 글자 수(앞뒤 공백 제외) */
  titleMaxLength: 80,
  /** 최대 게시 기간(개월, Asia/Seoul 달력 기준) */
  maxPublishMonths: 3,
  /** 게시 시작 전 최소 신청 시간(시간). 검토할 시간을 확보한다 */
  minLeadTimeHours: 24,
  /** 상세 링크(QR)로 허용하는 호스트. HTTPS만 허용한다 */
  allowedDetailUrlHosts: ['ziggle.gistory.me'],
} as const;

export function mediaKindOf(mimeType: AssetMimeType): MediaKind {
  return (VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)
    ? 'VIDEO'
    : 'IMAGE';
}

/** 지금 업로드를 받는 형식. 영상은 스위치가 켜져 있을 때만 받는다 */
export function allowedMimeTypes(
  videoUploadsEnabled: boolean,
): AssetMimeType[] {
  return videoUploadsEnabled ? [...ASSET_MIME_TYPES] : [...IMAGE_MIME_TYPES];
}

/** 받지 않는 형식을 올렸을 때 보여 줄 안내 */
export function acceptedFormatsMessage(videoUploadsEnabled: boolean): string {
  return videoUploadsEnabled
    ? 'JPEG, PNG, WebP 이미지나 MP4, MOV, WebM 영상만 올릴 수 있습니다.'
    : 'JPEG, PNG, WebP 파일만 올릴 수 있습니다.';
}

export function maxUploadBytesOf(kind: MediaKind): number {
  return kind === 'VIDEO'
    ? SIGNAGE_POLICY.maxVideoUploadBytes
    : SIGNAGE_POLICY.maxUploadBytes;
}
