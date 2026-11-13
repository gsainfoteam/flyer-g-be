import type { FieldErrors } from '../../common/errors/app.exception.js';
import { SIGNAGE_POLICY } from '../../policy/signage-policy.js';
import { parseDetailUrl, validatePeriod } from '../submission-rules.js';
import { checkMediaAsset, type MediaProblem } from './media-asset.js';
import type { PlaylistItemDto } from '../../playlist/dto/playlist.dto.js';
import {
  EMPTY_KIND_RESPONSE,
  patched,
  type MediaUrls,
  type PlaylistRow,
  type SubmissionKind,
} from './submission-kind.js';

const DAY_MS = 86_400_000;

const ASSET_MESSAGES: Record<MediaProblem, string> = {
  UPLOADING: '포스터 업로드가 끝나지 않았습니다.',
  PROCESSING: '영상 변환이 끝나지 않았습니다. 잠시 후 다시 시도해주세요.',
  MISSING: '포스터를 다시 올려주세요.',
  VIDEO: '포스터를 다시 올려주세요.',
};

/**
 * 포스터(이미지·영상). 신청자가 기간을 정하고, 최대 maxPublishDays일이다.
 * 포스터의 필드는 모두 submissions 컬럼에 있다(공지 하나에 신청 하나를 DB가 지키는 부분 unique index 때문).
 */
export const POSTER_KIND: SubmissionKind<null> = {
  type: 'POSTER',

  inputFields: [
    'title',
    'categoryId',
    'assetId',
    'detailUrl',
    'organizerName',
    'subtitle',
    'location',
    'description',
  ],

  schedule: {
    mode: 'REQUESTED',
    validate(startAt, endAt, now) {
      const errors = validatePeriod(startAt, endAt, now);
      const { maxPublishDays } = SIGNAGE_POLICY;
      if (
        !errors.endAt &&
        endAt.getTime() - startAt.getTime() > maxPublishDays * DAY_MS
      ) {
        errors.endAt = `게시 기간은 최대 ${maxPublishDays}일입니다.`;
      }
      return errors;
    },
  },

  targetable: true,
  dailyLimit: null,
  resubmittable: true,
  anonymous: false,

  async resolve(input, current, ctx) {
    const errors: FieldErrors = {};
    const prev = current?.columns;
    // 생성 때는 DTO가 필수 필드를 이미 확인했다
    const categoryId = input.categoryId ?? prev!.categoryId!;
    const assetId = input.assetId ?? prev!.assetId!;

    let detailUrl = prev?.detailUrl ?? null;
    let ziggleNoticeId = prev?.ziggleNoticeId ?? null;
    if (input.detailUrl !== undefined) {
      const parsed = input.detailUrl ? parseDetailUrl(input.detailUrl) : null;
      if (parsed && 'error' in parsed) {
        errors.detailUrl = parsed.error;
      } else {
        detailUrl = parsed?.url ?? null;
        ziggleNoticeId = parsed?.ziggleNoticeId ?? null;
      }
    }

    const [categoryOk, assetProblem] = await Promise.all([
      categoryId === prev?.categoryId || ctx.isActiveCategory(categoryId),
      assetId === prev?.assetId
        ? null
        : checkMediaAsset(ctx, assetId, { allowVideo: true }),
    ]);
    if (!categoryOk) {
      errors.categoryId = '선택할 수 없는 카테고리입니다.';
    }
    if (assetProblem) {
      errors.assetId = ASSET_MESSAGES[assetProblem];
    }

    return {
      errors,
      columns: {
        title: input.title ?? prev!.title,
        categoryId,
        assetId,
        detailUrl,
        ziggleNoticeId,
        organizerName: patched(
          input.organizerName,
          prev?.organizerName ?? null,
        ),
        subtitle: patched(input.subtitle, prev?.subtitle ?? null),
        location: patched(input.location, prev?.location ?? null),
        description: patched(input.description, prev?.description ?? null),
      },
      detail: null,
    };
  },

  details: null,

  toResponse(row, _detail, media) {
    const poster = media.variantUrls(row.assetId!);
    return {
      ...EMPTY_KIND_RESPONSE,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      assetId: row.assetId,
      posterUrl: poster.preview,
      posterThumbUrl: poster.thumb,
      posterKind: row.assetKind,
      posterWidth: row.assetWidth,
      posterHeight: row.assetHeight,
      posterDurationMs: row.assetDurationMs,
      posterVideoUrl: media.videoUrl({
        id: row.assetId!,
        kind: row.assetKind!,
      }),
      detailUrl: row.detailUrl,
      ziggleNoticeId: row.ziggleNoticeId,
      organizerName: row.organizerName,
      subtitle: row.subtitle,
      location: row.location,
      description: row.description,
    };
  },

  toPlaylistItem(row, _detail, media) {
    return posterPlaylistItem(row, media);
  },
};

/**
 * 포스터 편성 항목. 편성 v1의 items와 v2의 submissions.POSTER가 같은 모양이다.
 * 키 순서까지 v1 playlistVersion에 들어가므로 바꾸지 않는다.
 */
export function posterPlaylistItem(
  row: PlaylistRow,
  media: MediaUrls,
): PlaylistItemDto {
  // 포스터는 asset이 항상 있고, 편성 조회가 READY인 것만 남긴다
  const asset = row.asset!;
  return {
    submissionId: row.id,
    revision: row.version,
    title: row.title,
    category: row.categoryName!,
    kind: asset.kind,
    width: asset.width!,
    height: asset.height!,
    durationMs: asset.durationMs,
    assetUrl: media.variantUrls(asset.id).tv,
    video:
      asset.kind === 'VIDEO'
        ? {
            url: media.videoUrl({ id: asset.id, kind: asset.kind })!,
            hasAudio: asset.hasAudio!,
          }
        : null,
    detailUrl: row.detailUrl,
    startsAt: row.startAt.toISOString(),
    endsAt: row.endAt.toISOString(),
    priority: row.priority,
    checksum: asset.checksum!,
    subtitle: row.subtitle,
    location: row.location,
    organizerName: row.organizerName,
  };
}
