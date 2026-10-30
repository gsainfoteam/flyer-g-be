import { Trace } from '@gsainfoteam/nest-observability';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { and, asc, eq, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { assets, type Asset } from '../db/schema.js';
import { SIGNAGE_POLICY } from '../policy/signage-policy.js';
import { enqueueStorageDeletions } from '../storage/storage-deletions.js';
import { StorageService } from '../storage/storage.service.js';
import {
  deleteOriginal,
  IMMUTABLE_CACHE,
  markRejected,
  uploadKey,
  variantKey,
  variantKeysOf,
  videoKey,
} from './asset-files.js';
import {
  MediaRejectedError,
  VARIANTS,
  type VariantName,
} from './image-processor.js';
import { processVideo, sha256File } from './video-processor.js';

// 변환 시간 제한(5분)과 업로드 시간을 넉넉히 넘긴 값. 이보다 오래 잡혀 있으면 파드가 죽은 것으로 본다.
const STALE_AFTER_MS = 15 * 60 * 1000;
// 저장소 장애·ffmpeg 강제 종료 같은 일시적 실패를 이만큼 다시 시도한 뒤 거절한다.
export const MAX_PROCESSING_ATTEMPTS = 3;
const GAVE_UP_REASON = '영상을 처리하지 못했습니다. 잠시 후 다시 올려주세요.';

export type VideoProcessingResult = {
  ready: number;
  rejected: number;
  /** 일시적으로 실패해 다음 실행에서 다시 시도할 수 */
  retried: number;
};

/**
 * 영상 변환 대기열. 영상은 변환에 수십 초가 걸려 complete 요청 안에서 처리하지 않는다.
 * - complete가 asset을 PROCESSING으로 바꾸고 kick()을 부른다. 같은 파드가 바로 처리한다
 * - 주기 작업(1분)이 drain()을 불러 남은 것을 처리한다. 파드가 재시작됐거나 일시적으로 실패한 것
 *
 * 대기열은 assets 테이블 자체다. 가져갈 때 processing_started_at을 적어 다른 파드가 겹쳐 가져가지 않게 하고,
 * 그 값이 오래됐으면 멈춘 것으로 보고 다시 가져간다. 파드 하나는 한 번에 하나만 변환한다(CPU·메모리).
 */
@Trace()
@Injectable()
export class VideoProcessingService implements OnModuleDestroy {
  private readonly logger = new Logger(VideoProcessingService.name);
  private running: Promise<VideoProcessingResult> | null = null;
  private stopping = false;

  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  /** 응답을 기다리게 하지 않고 처리를 시작한다. 이미 처리 중이면 그 실행이 이어서 가져간다. */
  kick(): void {
    void this.drain().catch((error: unknown) =>
      this.logger.error('Video processing failed', error),
    );
  }

  /** 가져갈 수 있는 영상이 없을 때까지 하나씩 처리한다. 이미 도는 중이면 그 결과를 기다린다. */
  drain(): Promise<VideoProcessingResult> {
    if (!this.running) {
      this.running = this.drainOnce().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  async onModuleDestroy(): Promise<void> {
    // 처리 중인 것은 끝내고 닫는다. 끝내지 못하고 죽으면 다른 파드가 STALE_AFTER_MS 뒤 다시 가져간다.
    this.stopping = true;
    await this.running?.catch(() => undefined);
  }

  private async drainOnce(): Promise<VideoProcessingResult> {
    const result: VideoProcessingResult = { ready: 0, rejected: 0, retried: 0 };
    // 이번 실행에서 일시적으로 실패한 것은 다시 가져가지 않는다. 다음 주기에 시도한다
    const failed: string[] = [];
    while (!this.stopping) {
      const asset = await this.claim(failed);
      if (!asset) {
        break;
      }
      const outcome = await this.process(asset);
      result[outcome] += 1;
      if (outcome === 'retried') {
        failed.push(asset.id);
      }
    }
    return result;
  }

  /** 다음 영상을 가져간다. 동시에 여러 파드가 불러도 하나만 가져간다 */
  private async claim(exclude: string[]): Promise<Asset | null> {
    const now = new Date();
    const next = this.db
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.status, 'PROCESSING'),
          or(
            isNull(assets.processingStartedAt),
            lt(
              assets.processingStartedAt,
              new Date(now.getTime() - STALE_AFTER_MS),
            ),
          ),
          exclude.length > 0 ? notInArray(assets.id, exclude) : undefined,
        ),
      )
      .orderBy(asc(assets.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });

    const [claimed] = await this.db
      .update(assets)
      .set({
        processingStartedAt: now,
        processingAttempts: sql`${assets.processingAttempts} + 1`,
        updatedAt: now,
      })
      .where(sql`${assets.id} = (${next})`)
      .returning();
    return claimed ?? null;
  }

  private async process(asset: Asset): Promise<keyof VideoProcessingResult> {
    if (asset.processingAttempts > MAX_PROCESSING_ATTEMPTS) {
      this.logger.warn(
        `Giving up on video ${asset.id} after ${MAX_PROCESSING_ATTEMPTS} attempts`,
      );
      await this.reject(asset, GAVE_UP_REASON);
      return 'rejected';
    }

    const workDir = await mkdtemp(join(tmpdir(), `flyer-g-video-${asset.id}-`));
    try {
      const inputPath = join(workDir, 'original');
      await this.storage.downloadToFile(uploadKey(asset.id), inputPath);

      const { size } = await stat(inputPath);
      if (size > SIGNAGE_POLICY.maxVideoUploadBytes) {
        await this.reject(
          asset,
          `파일은 ${SIGNAGE_POLICY.maxVideoUploadBytes / 1024 / 1024}MB 이하여야 합니다.`,
        );
        return 'rejected';
      }
      const checksum = await sha256File(inputPath);
      if (asset.declaredChecksum && checksum !== asset.declaredChecksum) {
        await this.reject(
          asset,
          '업로드 중 파일이 손상되었습니다. 다시 올려주세요.',
        );
        return 'rejected';
      }

      const processed = await processVideo(inputPath, workDir, {
        maxDurationSeconds: SIGNAGE_POLICY.maxVideoDurationSeconds,
      });

      await Promise.all([
        this.storage.putFile(videoKey(asset.id), processed.videoPath, {
          contentType: 'video/mp4',
          cacheControl: IMMUTABLE_CACHE,
        }),
        ...(Object.keys(VARIANTS) as VariantName[]).map((variant) =>
          this.storage.put(
            variantKey(asset.id, variant),
            processed.variants[variant],
            { contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE },
          ),
        ),
      ]);

      const now = new Date();
      const [ready] = await this.db
        .update(assets)
        .set({
          status: 'READY',
          mimeType: processed.mimeType,
          width: processed.width,
          height: processed.height,
          durationMs: processed.durationMs,
          hasAudio: processed.hasAudio,
          sizeBytes: size,
          checksum,
          processedAt: now,
          updatedAt: now,
        })
        .where(this.stillClaimed(asset))
        .returning({ id: assets.id });

      await deleteOriginal(this.db, this.storage, this.logger, asset.id);
      if (!ready) {
        await this.handleLostClaim(asset);
        return 'retried';
      }
      return 'ready';
    } catch (error) {
      if (error instanceof MediaRejectedError) {
        await this.reject(asset, error.message);
        return 'rejected';
      }
      // 저장소 장애, ffmpeg 강제 종료·시간 초과 등. 다음 주기에 다시 시도하도록 잡은 것을 놓는다
      this.logger.warn(
        `Video ${asset.id} failed (attempt ${asset.processingAttempts}); will retry`,
        error,
      );
      await this.db
        .update(assets)
        .set({ processingStartedAt: null })
        .where(this.stillClaimed(asset));
      return 'retried';
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /** 처리하는 사이 다른 파드가 (멈춘 것으로 보고) 다시 가져가지 않았는지 */
  private stillClaimed(asset: Asset) {
    return and(
      eq(assets.id, asset.id),
      eq(assets.status, 'PROCESSING'),
      eq(assets.processingStartedAt, asset.processingStartedAt!),
    );
  }

  private async reject(asset: Asset, reason: string): Promise<void> {
    await markRejected(
      this.db,
      this.storage,
      this.logger,
      asset,
      'PROCESSING',
      reason,
    );
  }

  /**
   * 결과를 저장하지 못했다. 다른 파드가 다시 가져갔으면 그쪽이 같은 경로에 덮어쓰므로 둔다.
   * 정리 작업이 그 사이 행을 지웠으면 방금 올린 파일은 아무도 추적하지 않으므로 삭제 대기열에 넣는다.
   */
  private async handleLostClaim(asset: Asset): Promise<void> {
    const [current] = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, asset.id));
    if (!current) {
      await enqueueStorageDeletions(
        this.db,
        variantKeysOf(asset.id),
        new Date(),
      );
    }
  }
}
