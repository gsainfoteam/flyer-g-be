import { Trace } from '@gsainfoteam/nest-observability';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { Env } from '../config/env.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { assets, type Asset } from '../db/schema.js';
import {
  acceptedFormatsMessage,
  allowedMimeTypes,
  maxUploadBytesOf,
  mediaKindOf,
  type AssetMimeType,
} from '../policy/signage-policy.js';
import { enqueueStorageDeletions } from '../storage/storage-deletions.js';
import { StorageService } from '../storage/storage.service.js';
import {
  deleteOriginal,
  IMMUTABLE_CACHE,
  markRejected,
  rejection,
  uploadKey,
  variantKey,
  variantKeysOf,
  videoKey,
} from './asset-files.js';
import type { AssetDto, AssetProcessingDto } from './dto/asset.dto.js';
import type {
  PresignAssetRequestDto,
  PresignAssetResponseDto,
} from './dto/presign-asset.dto.js';
import {
  MediaRejectedError,
  processImage,
  sha256Checksum,
  VARIANTS,
  type VariantName,
} from './image-processor.js';
import { VideoProcessingService } from './video-processing.service.js';

// 큰 파일도 느린 망에서 올릴 수 있을 만큼 넉넉하게 둔다.
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
// 영상 변환을 기다리는 동안 complete를 다시 부를 간격
export const PROCESSING_RETRY_AFTER_SECONDS = 5;

/**
 * 포스터 업로드 (요구사항 4절, presign 방식)
 * 1. presign: asset을 만들고 저장소에 직접 올릴 서명 URL을 준다
 * 2. 브라우저가 서명 URL로 PUT한다 (진행률·취소는 브라우저가 처리)
 * 3. complete: 원본을 검증하고 메타데이터를 뺀 공개용 파일을 만든 뒤 원본을 지운다
 *    - 이미지: 요청 안에서 바로 처리한다
 *    - 영상: 변환 대기열에 넣고 PROCESSING을 준다. 끝날 때까지 complete를 다시 부른다
 */
@Trace()
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly videoUploadsEnabled: boolean;

  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly videoProcessing: VideoProcessingService,
    config: ConfigService<Env, true>,
  ) {
    this.videoUploadsEnabled = config.get('VIDEO_UPLOADS_ENABLED', {
      infer: true,
    });
  }

  async presign(
    ownerId: string,
    dto: PresignAssetRequestDto,
  ): Promise<PresignAssetResponseDto> {
    if (!allowedMimeTypes(this.videoUploadsEnabled).includes(dto.mimeType)) {
      // 알 수 없는 형식(image/gif 등)과 스위치가 꺼진 영상이 여기서 걸린다
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.VALIDATION_FAILED,
        'Media type is not accepted',
        { mimeType: acceptedFormatsMessage(this.videoUploadsEnabled) },
      );
    }
    const kind = mediaKindOf(dto.mimeType);
    const maxUploadBytes = maxUploadBytesOf(kind);
    if (dto.sizeBytes > maxUploadBytes) {
      throw new AppException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        ErrorCode.PAYLOAD_TOO_LARGE,
        `File exceeds ${maxUploadBytes} bytes`,
        {
          sizeBytes: `파일은 ${maxUploadBytes / 1024 / 1024}MB 이하여야 합니다.`,
        },
      );
    }

    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    const [asset] = await this.db
      .insert(assets)
      .values({
        ownerId,
        kind,
        fileName: dto.fileName,
        declaredMimeType: dto.mimeType,
        declaredSizeBytes: dto.sizeBytes,
        declaredChecksum: dto.checksum ?? null,
        uploadExpiresAt: expiresAt,
      })
      .returning({ id: assets.id });

    const uploadUrl = await this.storage.presignPut(uploadKey(asset.id), {
      contentType: dto.mimeType,
      contentLength: dto.sizeBytes,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return {
      assetId: asset.id,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': dto.mimeType },
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * 여러 번 불러도 결과가 같다. 이미 끝난 asset은 저장된 결과(또는 같은 거절 사유)를 준다.
   * 동시에 두 번 불리면 둘 다 처리하지만 결과 파일 경로가 같아 덮어쓸 뿐이다.
   * 영상은 변환이 끝날 때까지 PROCESSING을 준다.
   */
  async complete(
    ownerId: string,
    assetId: string,
  ): Promise<AssetDto | AssetProcessingDto> {
    const asset = await this.findOwned(ownerId, assetId);
    if (asset.status === 'READY') {
      return this.toDto(asset);
    }
    if (asset.status === 'REJECTED') {
      throw rejection(asset.rejectionReason ?? '올릴 수 없는 파일입니다.');
    }
    if (asset.status === 'PROCESSING') {
      return processing(asset);
    }

    const key = uploadKey(asset.id);
    const size = await this.storage.sizeOf(key);
    if (size === null) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_REQUEST,
        'File has not been uploaded yet',
      );
    }
    // 서명 URL이 크기를 강제하지만, 저장소가 그 조건을 무시해도 여기서 한 번 더 막는다.
    const maxUploadBytes = maxUploadBytesOf(asset.kind);
    if (size > maxUploadBytes) {
      return this.reject(
        asset,
        `파일은 ${maxUploadBytes / 1024 / 1024}MB 이하여야 합니다.`,
      );
    }

    if (asset.kind === 'VIDEO') {
      return this.enqueueVideo(ownerId, asset);
    }

    const bytes = await this.storage.getBytes(key);
    if (
      asset.declaredChecksum &&
      sha256Checksum(bytes) !== asset.declaredChecksum
    ) {
      return this.reject(
        asset,
        '업로드 중 파일이 손상되었습니다. 다시 올려주세요.',
      );
    }

    let processed;
    try {
      processed = await processImage(bytes);
    } catch (error) {
      if (error instanceof MediaRejectedError) {
        return this.reject(asset, error.message);
      }
      throw error;
    }

    await Promise.all(
      (Object.keys(VARIANTS) as VariantName[]).map((variant) =>
        this.storage.put(
          variantKey(asset.id, variant),
          processed.variants[variant],
          {
            contentType: 'image/webp',
            cacheControl: IMMUTABLE_CACHE,
          },
        ),
      ),
    );

    const now = new Date();
    const [ready] = await this.db
      .update(assets)
      .set({
        status: 'READY',
        mimeType: processed.mimeType,
        width: processed.width,
        height: processed.height,
        sizeBytes: bytes.length,
        checksum: processed.checksum,
        processedAt: now,
        updatedAt: now,
      })
      .where(and(eq(assets.id, asset.id), eq(assets.status, 'PENDING_UPLOAD')))
      .returning();

    await deleteOriginal(this.db, this.storage, this.logger, asset.id);
    if (ready) {
      return this.toDto(ready);
    }
    // 처리하는 사이 행이 바뀌었다. 동시에 들어온 다른 완료 요청이 먼저 끝냈으면 그 결과를 준다.
    const current = await this.findOwnedOrNull(ownerId, assetId);
    if (current) {
      return this.toDto(current);
    }
    // 정리 작업이 그 사이 행을 지웠다. 방금 올린 변형 이미지는 아무도 추적하지 않으므로 삭제 대기열에 넣는다.
    await enqueueStorageDeletions(this.db, variantKeysOf(asset.id), new Date());
    throw new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'Asset not found',
    );
  }

  /** 영상은 변환 대기열에 넣고 바로 돌려준다. 같은 파드가 곧바로 처리를 시작한다 */
  private async enqueueVideo(
    ownerId: string,
    asset: Asset,
  ): Promise<AssetDto | AssetProcessingDto> {
    const [queued] = await this.db
      .update(assets)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(and(eq(assets.id, asset.id), eq(assets.status, 'PENDING_UPLOAD')))
      .returning();
    this.videoProcessing.kick();
    if (queued) {
      return processing(queued);
    }
    // 동시에 들어온 다른 완료 요청이 먼저 넣었다. 그 사이 끝났으면 결과를 준다
    return this.complete(ownerId, asset.id);
  }

  async findById(assetId: string): Promise<Asset | null> {
    const [asset] = await this.db
      .select()
      .from(assets)
      .where(eq(assets.id, assetId));
    return asset ?? null;
  }

  /** 남의 asset이나 없는 asset은 null */
  async findOwnedOrNull(
    ownerId: string,
    assetId: string,
  ): Promise<Asset | null> {
    const [asset] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.ownerId, ownerId)));
    return asset ?? null;
  }

  /** 남의 asset이나 없는 asset은 404 */
  async findOwned(ownerId: string, assetId: string): Promise<Asset> {
    const asset = await this.findOwnedOrNull(ownerId, assetId);
    if (!asset) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Asset not found',
      );
    }
    return asset;
  }

  variantUrls(assetId: string): Record<VariantName, string> {
    return {
      thumb: this.storage.publicUrl(variantKey(assetId, 'thumb')),
      preview: this.storage.publicUrl(variantKey(assetId, 'preview')),
      tv: this.storage.publicUrl(variantKey(assetId, 'tv')),
    };
  }

  /** 영상 asset의 TV 재생용 mp4. 영상이 아니면 null */
  videoUrl(asset: Pick<Asset, 'id' | 'kind'>): string | null {
    return asset.kind === 'VIDEO'
      ? this.storage.publicUrl(videoKey(asset.id))
      : null;
  }

  private async reject(asset: Asset, reason: string): Promise<never> {
    await markRejected(
      this.db,
      this.storage,
      this.logger,
      asset,
      'PENDING_UPLOAD',
      reason,
    );
    throw rejection(reason);
  }

  private toDto(asset: Asset): AssetDto {
    const variants = this.variantUrls(asset.id);
    return {
      assetId: asset.id,
      status: 'READY',
      kind: asset.kind,
      url: variants.preview,
      mimeType: asset.mimeType as AssetMimeType,
      width: asset.width!,
      height: asset.height!,
      sizeBytes: asset.sizeBytes!,
      checksum: asset.checksum!,
      moderationStatus: 'APPROVED',
      variants,
      videoUrl: this.videoUrl(asset),
      durationMs: asset.durationMs,
      hasAudio: asset.hasAudio,
    };
  }
}

function processing(asset: Asset): AssetProcessingDto {
  return {
    assetId: asset.id,
    status: 'PROCESSING',
    kind: 'VIDEO',
    retryAfterSeconds: PROCESSING_RETRY_AFTER_SECONDS,
  };
}
