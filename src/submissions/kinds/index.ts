import type { SubmissionType } from '../../db/schema.js';
import { EVENT_BANNER_KIND } from './event-banner.kind.js';
import { POSTER_KIND } from './poster.kind.js';
import type { SubmissionKind } from './submission-kind.js';

export type { SubmissionKind } from './submission-kind.js';
export { KIND_INPUT_FIELDS } from './submission-kind.js';

/**
 * 종류 값마다 정의 하나. `submission_type` enum에 값을 더하면 여기를 채우기 전까지 컴파일되지 않는다.
 */
const SUBMISSION_KINDS = {
  POSTER: POSTER_KIND,
  EVENT_BANNER: EVENT_BANNER_KIND,
} as const satisfies Record<SubmissionType, SubmissionKind>;

export function kindOf(type: SubmissionType): SubmissionKind {
  return SUBMISSION_KINDS[type];
}

/** 하루 한도가 있는 종류만 담는다. GET /signage/config의 dailySubmissionLimits */
export function dailySubmissionLimits(): Partial<
  Record<SubmissionType, number>
> {
  const limits: Partial<Record<SubmissionType, number>> = {};
  for (const kind of Object.values<SubmissionKind>(SUBMISSION_KINDS)) {
    if (kind.dailyLimit !== null) {
      limits[kind.type] = kind.dailyLimit;
    }
  }
  return limits;
}
