import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import type { AllowedMimeType } from '../policy/signage-policy.js';

/**
 * 공개용 이미지 크기. 원본 대신 이걸 내려줘서 TV가 매번 수 MB를 받지 않게 한다.
 * 모두 비율을 유지한 채 상자 안에 맞추고, 원본보다 키우지 않는다.
 */
export const VARIANTS = {
  /** 관리자 목록 썸네일 */
  thumb: { width: 400, height: 400, quality: 75 },
  /** 신청·검토 화면 미리보기. 검토자가 화질을 판단할 수 있는 크기 */
  preview: { width: 1280, height: 1280, quality: 80 },
  /** TV 재생용 (1920x1080 화면) */
  tv: { width: 1920, height: 1080, quality: 85 },
} as const;

export type VariantName = keyof typeof VARIANTS;

// 압축 폭탄 방지. 10MB 안에 수억 픽셀을 담은 이미지를 디코딩하다 메모리가 터지지 않게 한다.
const MAX_INPUT_PIXELS = 50_000_000;

const MIME_BY_FORMAT: Partial<Record<string, AllowedMimeType>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** 사용자가 고쳐서 다시 올려야 하는 문제. message는 업로드 칸에 그대로 표시된다. */
export class ImageRejectedError extends Error {}

export type ProcessedImage = {
  /** 파일 내용으로 판별한 형식. 확장자·신고한 MIME은 믿지 않는다 */
  mimeType: AllowedMimeType;
  /** EXIF 회전을 적용한 뒤의 크기 */
  width: number;
  height: number;
  /** 원본 내용의 sha256. 같은 asset은 내용이 바뀌지 않으므로 TV 미디어 캐시 key로 쓴다 */
  checksum: string;
  /** webp. EXIF(위치 정보 포함)를 모두 뺐다 */
  variants: Record<VariantName, Buffer>;
};

export function sha256Checksum(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * 업로드된 원본을 검증하고 공개용 이미지를 만든다.
 * 형식은 파일 시그니처(매직바이트)로 판별하므로 확장자만 바꾼 SVG·실행 파일은 여기서 걸린다.
 */
export async function processImage(
  bytes: Buffer,
  options: { minShortEdgePx: number },
): Promise<ProcessedImage> {
  const input = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });

  let metadata: Metadata;
  try {
    metadata = await input().metadata();
  } catch {
    throw new ImageRejectedError(
      '이미지를 읽을 수 없습니다. JPEG, PNG, WebP 파일만 올릴 수 있습니다.',
    );
  }

  const mimeType = MIME_BY_FORMAT[metadata.format ?? ''];
  if (!mimeType) {
    throw new ImageRejectedError(
      '지원하지 않는 형식입니다. JPEG, PNG, WebP 파일만 올릴 수 있습니다.',
    );
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new ImageRejectedError('움직이는 이미지는 올릴 수 없습니다.');
  }

  const { width, height } = metadata.autoOrient;
  const shortEdge = Math.min(width, height);
  if (shortEdge < options.minShortEdgePx) {
    throw new ImageRejectedError(
      `짧은 변이 ${options.minShortEdgePx}px 이상이어야 합니다. (현재 ${shortEdge}px)`,
    );
  }

  const variants = {} as Record<VariantName, Buffer>;
  try {
    for (const [name, spec] of Object.entries(VARIANTS)) {
      // rotate(): EXIF 방향대로 돌린다. sharp는 출력에 메타데이터를 붙이지 않으므로 EXIF가 빠진다.
      variants[name as VariantName] = await input()
        .rotate()
        .resize({
          width: spec.width,
          height: spec.height,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: spec.quality })
        .toBuffer();
    }
  } catch {
    // 헤더는 멀쩡하지만 본문이 잘렸거나 깨진 파일
    throw new ImageRejectedError(
      '이미지가 손상되어 열 수 없습니다. 파일을 확인하고 다시 올려주세요.',
    );
  }

  return {
    mimeType,
    width,
    height,
    checksum: sha256Checksum(bytes),
    variants,
  };
}
