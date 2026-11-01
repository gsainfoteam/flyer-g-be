import { eq, inArray } from 'drizzle-orm';
import type { FieldErrors } from '../../common/errors/app.exception.js';
import { isSeoulMidnight } from '../../common/time/seoul-time.js';
import {
  submissionEventBanners,
  type EventBannerOccasion,
  type SubmissionEventBanner,
} from '../../db/schema.js';
import { SIGNAGE_POLICY } from '../../policy/signage-policy.js';
import { validatePeriod } from '../submission-rules.js';
import { checkMediaAsset, type MediaProblem } from './media-asset.js';
import {
  EMPTY_KIND_COLUMNS,
  EMPTY_KIND_RESPONSE,
  type SubmissionKind,
} from './submission-kind.js';

export type EventBannerDetail = Omit<SubmissionEventBanner, 'submissionId'>;

const DAY_MS = 86_400_000;

/** 목록 제목의 앞부분. 예: "생일 · 지민에게" */
const OCCASION_LABELS: Record<EventBannerOccasion, string> = {
  BIRTHDAY: '생일',
  ADMISSION: '합격',
  AWARD: '수상',
  WELCOME: '환영',
  OTHER: '소식',
};

/** 배너에는 영상을 쓰지 않으므로 변환 중(PROCESSING)인 asset도 영상이다 */
const MEDIA_MESSAGES: Record<
  'photoAssetId' | 'assetId',
  Record<MediaProblem, string>
> = {
  photoAssetId: {
    UPLOADING: '사진 업로드가 끝나지 않았습니다.',
    PROCESSING: '영상은 쓸 수 없습니다. 사진을 올려주세요.',
    VIDEO: '영상은 쓸 수 없습니다. 사진을 올려주세요.',
    MISSING: '사진을 다시 올려주세요.',
  },
  assetId: {
    UPLOADING: '배너 이미지 업로드가 끝나지 않았습니다.',
    PROCESSING: '영상은 쓸 수 없습니다. 이미지를 올려주세요.',
    VIDEO: '영상은 쓸 수 없습니다. 이미지를 올려주세요.',
    MISSING: '배너 이미지를 다시 올려주세요.',
  },
};

/**
 * 이벤트 배너(생일·합격·수상 같은 소식). 서울 자정부터 자정까지 1~eventBannerMaxDays일 나간다.
 * 이미지(IMAGE)나 사진(TEMPLATE)은 둘 중 하나만 있으므로 포스터처럼 submissions.asset_id에 둔다.
 * 그래서 승인 때 checksum 고정과 자산 정리 잡이 포스터와 똑같이 동작한다.
 */
export const EVENT_BANNER_KIND: SubmissionKind<EventBannerDetail> = {
  type: 'EVENT_BANNER',

  inputFields: ['eventBanner'],

  validateSchedule(startAt, endAt, now) {
    const errors = validatePeriod(startAt, endAt, now);
    const { eventBannerMaxDays } = SIGNAGE_POLICY;
    if (!isSeoulMidnight(startAt)) {
      errors.startAt = '시작은 서울 기준 자정(00:00)이어야 합니다.';
    }
    if (errors.endAt) {
      return errors;
    }
    if (!isSeoulMidnight(endAt)) {
      errors.endAt = '종료는 서울 기준 자정(00:00)이어야 합니다.';
    } else if (
      endAt.getTime() - startAt.getTime() >
      eventBannerMaxDays * DAY_MS
    ) {
      errors.endAt = `이벤트 배너는 최대 ${eventBannerMaxDays}일까지 걸 수 있습니다.`;
    }
    return errors;
  },

  dailyLimit: 3,

  async resolve(input, current, ctx) {
    const banner = input.eventBanner;
    if (!banner) {
      // 수정에서 내용을 보내지 않았으면 그대로 둔다. 생성은 DTO가 필수로 확인했다
      return current
        ? { errors: {}, ...current }
        : {
            errors: { eventBanner: '이벤트 배너 내용을 입력하세요.' },
            columns: EMPTY_KIND_COLUMNS,
            detail: emptyDetail(),
          };
    }

    const errors: FieldErrors = {};
    const isTemplate = banner.mode === 'TEMPLATE';
    if (isTemplate) {
      if (!banner.occasion) {
        errors['eventBanner.occasion'] = '어떤 소식인지 고르세요.';
      }
      if (!banner.message) {
        errors['eventBanner.message'] = '전할 말을 입력하세요.';
      }
      if (banner.assetId) {
        errors['eventBanner.assetId'] =
          '템플릿 배너에는 이미지를 쓸 수 없습니다. 사진은 photoAssetId로 넣으세요.';
      }
      if (banner.photoAssetId && !banner.photoConsent) {
        errors['eventBanner.photoConsent'] =
          '사진 속 사람의 동의를 받았는지 확인해 주세요.';
      }
    } else {
      if (!banner.assetId) {
        errors['eventBanner.assetId'] = '배너 이미지를 올려주세요.';
      }
      if (banner.photoAssetId) {
        errors['eventBanner.photoAssetId'] =
          '이미지 배너에는 사진을 따로 넣을 수 없습니다.';
      }
    }

    const mediaField = isTemplate ? 'photoAssetId' : 'assetId';
    const mediaId = (isTemplate ? banner.photoAssetId : banner.assetId) ?? null;
    if (mediaId && mediaId !== current?.columns.assetId) {
      const problem = await checkMediaAsset(ctx, mediaId, {
        allowVideo: false,
      });
      if (problem) {
        errors[`eventBanner.${mediaField}`] =
          MEDIA_MESSAGES[mediaField][problem];
      }
    }

    const occasion = banner.occasion ?? null;
    const label = occasion ? OCCASION_LABELS[occasion] : '이벤트 배너';
    return {
      errors,
      columns: {
        ...EMPTY_KIND_COLUMNS,
        title: `${label} · ${banner.recipient}에게`,
        assetId: mediaId,
      },
      detail: {
        mode: banner.mode,
        occasion,
        recipient: banner.recipient,
        message: banner.message ?? null,
        sender: banner.sender ?? null,
        photoConsent: isTemplate && mediaId !== null && !!banner.photoConsent,
      },
    };
  },

  details: {
    async load(db, ids) {
      const rows =
        ids.length === 0
          ? []
          : await db
              .select()
              .from(submissionEventBanners)
              .where(inArray(submissionEventBanners.submissionId, ids));
      return new Map(
        rows.map(({ submissionId, ...detail }) => [submissionId, detail]),
      );
    },

    async save(tx, submissionId, detail) {
      const [updated] = await tx
        .update(submissionEventBanners)
        .set(detail)
        .where(eq(submissionEventBanners.submissionId, submissionId))
        .returning({ id: submissionEventBanners.submissionId });
      if (!updated) {
        await tx
          .insert(submissionEventBanners)
          .values({ submissionId, ...detail });
      }
    },

    equals(a, b) {
      return (
        a.mode === b.mode &&
        a.occasion === b.occasion &&
        a.recipient === b.recipient &&
        a.message === b.message &&
        a.sender === b.sender &&
        a.photoConsent === b.photoConsent
      );
    },
  },

  toResponse(row, detail, media) {
    const isImage = detail.mode === 'IMAGE';
    const url = row.assetId ? media.variantUrls(row.assetId).preview : null;
    return {
      ...EMPTY_KIND_RESPONSE,
      eventBanner: {
        ...detail,
        photoAssetId: isImage ? null : row.assetId,
        photoUrl: isImage ? null : url,
        assetId: isImage ? row.assetId : null,
        assetUrl: isImage ? url : null,
      },
    };
  },
};

function emptyDetail(): EventBannerDetail {
  return {
    mode: 'TEMPLATE',
    occasion: null,
    recipient: '',
    message: null,
    sender: null,
    photoConsent: false,
  };
}
