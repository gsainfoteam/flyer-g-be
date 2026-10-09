import { HttpStatus, type Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { Database } from '../db/index.js';
import { assets, type Asset } from '../db/schema.js';
import { enqueueStorageDeletions } from '../storage/storage-deletions.js';
import type { StorageService } from '../storage/storage.service.js';
import { VARIANTS, type VariantName } from './image-processor.js';

// 공개 파일은 asset마다 내용이 바뀌지 않으므로 오래 캐시해도 된다.
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export const uploadKey = (assetId: string) => `uploads/${assetId}`;
export const variantKey = (assetId: string, variant: VariantName) =>
  `assets/${assetId}/${variant}.webp`;
export const videoKey = (assetId: string) => `assets/${assetId}/video.mp4`;

/** asset이 가질 수 있는 공개 파일 전부. 영상이 아니면 video.mp4는 없지만, 없는 키를 지워도 된다 */
export const variantKeysOf = (assetId: string) => [
  ...(Object.keys(VARIANTS) as VariantName[]).map((variant) =>
    variantKey(assetId, variant),
  ),
  videoKey(assetId),
];

/** 업로드 칸(fields.file)에 붙일 수 있게 필드 오류로 준다. */
export function rejection(reason: string): AppException {
  return new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.VALIDATION_FAILED,
    'Uploaded image was rejected',
    { file: reason },
  );
}

/** from 상태일 때만 거절로 바꾸고 원본을 지운다. 이미 다른 요청이 끝냈으면 그대로 둔다 */
export async function markRejected(
  db: Database,
  storage: StorageService,
  logger: Logger,
  asset: Pick<Asset, 'id'>,
  from: Asset['status'],
  reason: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(assets)
    .set({
      status: 'REJECTED',
      rejectionReason: reason,
      processedAt: now,
      updatedAt: now,
    })
    .where(and(eq(assets.id, asset.id), eq(assets.status, from)));
  await deleteOriginal(db, storage, logger, asset.id);
}

/**
 * 원본에는 EXIF·촬영 위치 정보가 있을 수 있어 처리 후 남기지 않는다. 실패해도 응답은 막지 않고,
 * 삭제 대기열에 넣어 업로드 정리 작업이 다시 시도하게 한다.
 */
export async function deleteOriginal(
  db: Database,
  storage: StorageService,
  logger: Logger,
  assetId: string,
): Promise<void> {
  const key = uploadKey(assetId);
  try {
    await storage.delete(key);
  } catch (error) {
    logger.warn(`Failed to delete ${key}; queued for retry`, error);
    await enqueueStorageDeletions(db, [key], new Date());
  }
}
