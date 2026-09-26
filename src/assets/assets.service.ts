import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { assets, type Asset } from '../db/schema.js';
import {
  SIGNAGE_POLICY,
  type AllowedMimeType,
} from '../policy/signage-policy.js';
import { StorageService } from '../storage/storage.service.js';
import type { AssetDto } from './dto/asset.dto.js';
import type {
  PresignAssetRequestDto,
  PresignAssetResponseDto,
} from './dto/presign-asset.dto.js';
import {
  ImageRejectedError,
  processImage,
  sha256Checksum,
  VARIANTS,
  type VariantName,
} from './image-processor.js';

// 큰 파일도 느린 망에서 올릴 수 있을 만큼 넉넉하게 둔다.
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
// 변형 이미지는 asset마다 내용이 바뀌지 않으므로 오래 캐시해도 된다.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export const uploadKey = (assetId: string) => `uploads/${assetId}`;
export const variantKey = (assetId: string, variant: VariantName) =>
  `assets/${assetId}/${variant}.webp`;

/**
 * 포스터 업로드 (요구사항 4절, presign 방식)
 * 1. presign: asset을 만들고 저장소에 직접 올릴 서명 URL을 준다
 * 2. 브라우저가 서명 URL로 PUT한다 (진행률·취소는 브라우저가 처리)
 * 3. complete: 원본을 검증하고 EXIF를 뺀 변형 이미지를 만든 뒤 원본을 지운다
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async presign(
    ownerId: string,
    dto: PresignAssetRequestDto,
  ): Promise<PresignAssetResponseDto> {
    const { maxUploadBytes } = SIGNAGE_POLICY;
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
   */
  async complete(ownerId: string, assetId: string): Promise<AssetDto> {
    const asset = await this.findOwned(ownerId, assetId);
    if (asset.status === 'READY') {
      return this.toDto(asset);
    }
    if (asset.status === 'REJECTED') {
      throw rejection(asset.rejectionReason ?? '올릴 수 없는 파일입니다.');
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
    if (size > SIGNAGE_POLICY.maxUploadBytes) {
      return this.reject(
        asset,
        `파일은 ${SIGNAGE_POLICY.maxUploadBytes / 1024 / 1024}MB 이하여야 합니다.`,
      );
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
      processed = await processImage(bytes, SIGNAGE_POLICY);
    } catch (error) {
      if (error instanceof ImageRejectedError) {
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

    await this.deleteOriginal(asset.id);
    // 동시에 들어온 다른 완료 요청이 먼저 끝냈으면 그 결과를 준다.
    return this.toDto(ready ?? (await this.findOwned(ownerId, assetId)));
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

  private async reject(asset: Asset, reason: string): Promise<never> {
    const now = new Date();
    await this.db
      .update(assets)
      .set({
        status: 'REJECTED',
        rejectionReason: reason,
        processedAt: now,
        updatedAt: now,
      })
      .where(and(eq(assets.id, asset.id), eq(assets.status, 'PENDING_UPLOAD')));
    await this.deleteOriginal(asset.id);
    throw rejection(reason);
  }

  /** 원본에는 EXIF 위치 정보가 있을 수 있어 처리 후 남기지 않는다. 실패해도 응답은 막지 않는다. */
  private async deleteOriginal(assetId: string): Promise<void> {
    await this.storage.delete(uploadKey(assetId)).catch((error: unknown) => {
      this.logger.error(`Failed to delete original upload ${assetId}`, error);
    });
  }

  private toDto(asset: Asset): AssetDto {
    const variants = this.variantUrls(asset.id);
    return {
      assetId: asset.id,
      url: variants.preview,
      mimeType: asset.mimeType as AllowedMimeType,
      width: asset.width!,
      height: asset.height!,
      sizeBytes: asset.sizeBytes!,
      checksum: asset.checksum!,
      moderationStatus: 'APPROVED',
      variants,
    };
  }
}

/** 업로드 칸(fields.file)에 붙일 수 있게 필드 오류로 준다. */
function rejection(reason: string): AppException {
  return new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.VALIDATION_FAILED,
    'Uploaded image was rejected',
    { file: reason },
  );
}
