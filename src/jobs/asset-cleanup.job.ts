import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { uploadKey, variantKey } from '../assets/assets.service.js';
import { VARIANTS, type VariantName } from '../assets/image-processor.js';
import { DB_CONNECTION, type Database, type Transaction } from '../db/index.js';
import { assets, submissions, type Asset } from '../db/schema.js';
import { StorageService } from '../storage/storage.service.js';
import { JobLock, withJobLock } from './job-lock.js';

// 서명 URL이 만료된 뒤에도 업로드가 끝나 가는 중일 수 있어 여유를 둔다.
const PENDING_GRACE_MS = 60 * 60 * 1000;
// 올려 두고 신청서를 쓰는 중일 수 있어 넉넉히 기다린다.
const UNUSED_READY_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
// 거절 사유를 다시 조회할 수 있게 잠시 남긴다. 원본은 거절할 때 이미 지웠다.
const REJECTED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// 한 번에 너무 오래 잠금을 잡지 않도록 나눠 지운다. 남은 것은 다음 실행에서 지운다.
const BATCH = 100;

export type AssetCleanupResult = {
  pending: number;
  unused: number;
  rejected: number;
};

/**
 * 신청에 쓰이지 않은 업로드를 정리한다 (요구사항 4절 확인 필요 8번).
 * - 업로드를 끝내지 않은 것: 행과 원본(uploads/)을 지운다. 원본에는 EXIF 위치 정보가 있을 수 있다
 * - 올렸지만 어떤 신청도 쓰지 않는 것: 행과 변형 이미지(assets/)를 지운다
 * - 거절된 것: 행만 지운다
 * 신청이 가리키는 asset은 FK 때문에 지워지지 않는다.
 */
@Injectable()
export class AssetCleanupJob {
  private readonly logger = new Logger(AssetCleanupJob.name);

  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async run(now = new Date()): Promise<AssetCleanupResult | null> {
    // 행을 먼저 지우고(커밋) 파일은 그 뒤에 지운다. 반대 순서면 롤백될 때 행만 남고 파일이 사라진다.
    const removed = await withJobLock(
      this.db,
      JobLock.ASSET_CLEANUP,
      async (tx) => ({
        pending: await this.remove(
          tx,
          and(
            eq(assets.status, 'PENDING_UPLOAD'),
            lt(
              assets.uploadExpiresAt,
              new Date(now.getTime() - PENDING_GRACE_MS),
            ),
          ),
        ),
        unused: await this.remove(
          tx,
          and(
            eq(assets.status, 'READY'),
            lt(
              assets.createdAt,
              new Date(now.getTime() - UNUSED_READY_AFTER_MS),
            ),
          ),
        ),
        rejected: await this.remove(
          tx,
          and(
            eq(assets.status, 'REJECTED'),
            lt(assets.createdAt, new Date(now.getTime() - REJECTED_KEEP_MS)),
          ),
        ),
      }),
    );
    if (!removed) {
      return null;
    }

    const keys = [
      ...removed.pending.map((asset) => uploadKey(asset.id)),
      ...removed.unused.flatMap((asset) =>
        (Object.keys(VARIANTS) as VariantName[]).map((variant) =>
          variantKey(asset.id, variant),
        ),
      ),
    ];
    for (const key of keys) {
      // 파일 삭제에 실패해도 행은 이미 없다. 로그로 남기고 계속한다.
      await this.storage.delete(key).catch((error: unknown) => {
        this.logger.error(`Failed to delete ${key}`, error);
      });
    }

    return {
      pending: removed.pending.length,
      unused: removed.unused.length,
      rejected: removed.rejected.length,
    };
  }

  /** 어떤 신청도 가리키지 않는 asset만 지운다. */
  private remove(
    tx: Transaction,
    where: ReturnType<typeof and>,
  ): Promise<Pick<Asset, 'id'>[]> {
    const candidates = tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          where,
          sql`not exists (select 1 from ${submissions} where ${submissions.assetId} = ${assets.id})`,
        ),
      )
      .limit(BATCH);
    return tx
      .delete(assets)
      .where(sql`${assets.id} in (${candidates})`)
      .returning({ id: assets.id });
  }
}
