/**
 * 게시 운영 정책의 단일 원천. 서버 검증과 GET /signage/config가 같은 값을 쓴다.
 * 프론트가 이 값을 받아 폼에서 미리 막으므로 "올릴 수 있다고 했는데 거절당하는" 일이 없다.
 *
 * 배포 환경마다 달라질 값이 아니라 제품 정책이므로 환경변수가 아니라 코드에 둔다.
 * 바꿀 때는 PR로 바꾸고 프론트에도 알린다.
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const SIGNAGE_POLICY = {
  /** 포스터 최대 용량(바이트) */
  maxUploadBytes: 10 * 1024 * 1024,
  /** 포스터 짧은 변 최소 픽셀. TV(1920x1080)에서 뭉개지지 않는 기준 */
  minShortEdgePx: 1080,
  /** 제목 최대 글자 수(앞뒤 공백 제외) */
  titleMaxLength: 80,
  /** 최대 게시 기간(개월, Asia/Seoul 달력 기준) */
  maxPublishMonths: 3,
  /** 게시 시작 전 최소 신청 시간(시간). 검토할 시간을 확보한다 */
  minLeadTimeHours: 24,
  allowedMimeTypes: ALLOWED_MIME_TYPES,
  /** 상세 링크(QR)로 허용하는 호스트. HTTPS만 허용한다 */
  allowedDetailUrlHosts: ['ziggle.gistory.me'],
} as const;
