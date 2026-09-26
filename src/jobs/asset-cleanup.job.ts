import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { uploadKey, variantKeysOf } from '../assets/assets.service.js';
import { DB_CONNECTION, type Database, type Transaction } from '../db/index.js';
import {
  assets,
  storageDeletions,
  submissions,
  type Asset,
} from '../db/schema.js';
import { enqueueStorageDeletions } from '../storage/storage-deletions.js';
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
// 한 번에 처리할 파일 삭제 수. 실패해서 쌓인 것도 여기서 다시 시도한다.
const DELETION_BATCH = 500;

export type AssetCleanupResult = {
  pending: number;
  unused: number;
  rejected: number;
  /** 저장소에서 지운 파일 수 (이전 실행에서 실패해 남은 것 포함) */
  filesDeleted: number;
  /** 삭제에 실패해 다음 실행에서 다시 시도할 파일 수 */
  filesFailed: number;
};

/**
 * 신청에 쓰이지 않은 업로드를 정리한다 (요구사항 4절 확인 필요 8번).
 * - 업로드를 끝내지 않은 것: 행과 원본(uploads/)을 지운다. 원본에는 EXIF 위치 정보가 있을 수 있다
 * - 올렸지만 어떤 신청도 쓰지 않는 것: 행과 변형 이미지(assets/)를 지운다
 * - 거절된 것: 행만 지운다
 * 신청이 가리키는 asset은 FK 때문에 지워지지 않는다.
 *
 * 파일은 행과 같은 트랜잭션에서 삭제 대기열(storage_deletions)에 기록하고, 삭제에 성공해야 대기열에서 뺀다.
 * 저장소 장애로 삭제가 실패해도 키가 남아 다음 실행에서 다시 시도한다. 업로드 완료·거절 처리에서
 * 원본 삭제가 실패한 것도 같은 대기열로 들어온다(src/assets/assets.service.ts).
 */
@Injectable()
export class AssetCleanupJob {
  private readonly logger = new Logger(AssetCleanupJob.name);

  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async run(now = new Date()): Promise<AssetCleanupResult | null> {
    const removed = await withJobLock(
      this.db,
      JobLock.ASSET_CLEANUP,
      async (tx) => {
        const pending = await this.remove(
          tx,
          and(
            eq(assets.status, 'PENDING_UPLOAD'),
            lt(
              assets.uploadExpiresAt,
              new Date(now.getTime() - PENDING_GRACE_MS),
            ),
          ),
        );
        const unused = await this.remove(
          tx,
          and(
            eq(assets.status, 'READY'),
            lt(
              assets.createdAt,
              new Date(now.getTime() - UNUSED_READY_AFTER_MS),
            ),
          ),
        );
        const rejected = await this.remove(
          tx,
          and(
            eq(assets.status, 'REJECTED'),
            lt(assets.createdAt, new Date(now.getTime() - REJECTED_KEEP_MS)),
          ),
        );

        // 행 삭제와 함께 커밋된다. 롤백되면 행도 키도 그대로 남는다.
        await enqueueStorageDeletions(
          tx,
          [
            ...pending.map((asset) => uploadKey(asset.id)),
            ...unused.flatMap((asset) => variantKeysOf(asset.id)),
          ],
          now,
        );
        return {
          pending: pending.length,
          unused: unused.length,
          rejected: rejected.length,
        };
      },
    );
    if (!removed) {
      return null;
    }

    const files = await this.drainStorageDeletions(now);
    return { ...removed, ...files };
  }

  /**
   * 삭제 대기열의 파일을 지운다. 성공한 키만 대기열에서 빼고, 실패한 키는 시도 횟수와 오류를 남겨
   * 다음 실행에서 다시 시도한다. 없는 파일을 지워도 성공이라 여러 번 시도해도 안전하다.
   */
  private async drainStorageDeletions(
    now: Date,
  ): Promise<{ filesDeleted: number; filesFailed: number }> {
    const drained = await withJobLock(
      this.db,
      JobLock.ASSET_CLEANUP,
      async (tx) => {
        const queued = await tx
          .select({ key: storageDeletions.key })
          .from(storageDeletions)
          .orderBy(asc(storageDeletions.createdAt))
          .limit(DELETION_BATCH);

        let filesDeleted = 0;
        let filesFailed = 0;
        for (const { key } of queued) {
          try {
            await this.storage.delete(key);
            await tx
              .delete(storageDeletions)
              .where(eq(storageDeletions.key, key));
            filesDeleted += 1;
          } catch (error) {
            filesFailed += 1;
            this.logger.warn(`Failed to delete ${key}; will retry`, error);
            await tx
              .update(storageDeletions)
              .set({
                attempts: sql`${storageDeletions.attempts} + 1`,
                lastError: String(error).slice(0, 500),
                lastAttemptAt: now,
              })
              .where(eq(storageDeletions.key, key));
          }
        }
        return { filesDeleted, filesFailed };
      },
    );
    // 다른 파드가 대기열을 처리 중이면 이번에는 넘긴다.
    return drained ?? { filesDeleted: 0, filesFailed: 0 };
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
