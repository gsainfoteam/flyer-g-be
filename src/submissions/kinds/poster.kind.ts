import { addMonthsInSeoul } from '../../common/time/seoul-time.js';
import { SIGNAGE_POLICY } from '../../policy/signage-policy.js';
import { validatePeriod } from '../submission-rules.js';
import type { SubmissionKind } from './submission-kind.js';

/** 포스터(이미지·영상). 신청자가 기간을 정하고, 최대 maxPublishMonths개월이다. */
export const POSTER_KIND: SubmissionKind = {
  type: 'POSTER',

  validateSchedule(startAt, endAt, now) {
    const errors = validatePeriod(startAt, endAt, now);
    const { maxPublishMonths } = SIGNAGE_POLICY;
    if (!errors.endAt && endAt > addMonthsInSeoul(startAt, maxPublishMonths)) {
      errors.endAt = `게시 기간은 최대 ${maxPublishMonths}개월입니다.`;
    }
    return errors;
  },

  dailyLimit: null,
};
