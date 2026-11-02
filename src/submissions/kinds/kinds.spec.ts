import { submissionTypeEnum } from '../../db/schema.js';
import { dailySubmissionLimits, KIND_INPUT_FIELDS, kindOf } from './index.js';
import { POSTER_KIND } from './poster.kind.js';

const NOW = new Date('2026-07-29T06:30:00.000Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);
const kst = (iso: string) => new Date(`${iso}+09:00`);

describe('SUBMISSION_KINDS', () => {
  it.each(submissionTypeEnum.enumValues)(
    '%s의 정의는 자기 type을 가진다',
    (type) => {
      expect(kindOf(type).type).toBe(type);
    },
  );

  it.each(submissionTypeEnum.enumValues)(
    '%s의 inputFields는 공통 목록 안에 있다',
    (type) => {
      for (const field of kindOf(type).inputFields) {
        expect(KIND_INPUT_FIELDS).toContain(field);
      }
    },
  );

  it('하루 한도는 한도가 있는 종류만 담는다', () => {
    expect(dailySubmissionLimits()).toEqual({ EVENT_BANNER: 3 });
  });
});

describe('POSTER_KIND.validateSchedule', () => {
  it('시작 시각이 지금이거나 지났어도 받는다 (24시간 전 신청 규칙 없음)', () => {
    expect(POSTER_KIND.validateSchedule(NOW, hours(24), NOW)).toEqual({});
    expect(POSTER_KIND.validateSchedule(hours(-3), hours(24), NOW)).toEqual({});
  });

  it('공통 기간 규칙을 따른다', () => {
    expect(POSTER_KIND.validateSchedule(hours(48), hours(48), NOW)).toEqual({
      endAt: '종료 시각은 시작 시각보다 뒤여야 합니다.',
    });
  });

  it('최대 게시 기간(3개월, 서울 달력)을 넘으면 endAt 오류', () => {
    const start = kst('2026-11-30T09:00:00');
    expect(
      POSTER_KIND.validateSchedule(start, kst('2027-02-28T09:00:00'), NOW),
    ).toEqual({});
    expect(
      POSTER_KIND.validateSchedule(start, kst('2027-02-28T09:00:01'), NOW),
    ).toEqual({ endAt: '게시 기간은 최대 3개월입니다.' });
  });
});
