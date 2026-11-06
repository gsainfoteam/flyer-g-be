import { reviewMessage, reviewReminderSlot } from './notification-messages.js';

describe('승인 리마인드', () => {
  it.each([
    ['2026-11-06T01:00:00Z', '2026-11-06T10:00'],
    ['2026-11-06T07:00:59Z', '2026-11-06T16:00'],
    ['2026-11-09T01:00:00Z', '2026-11-09T10:00'],
    ['2026-11-07T01:00:00Z', null],
    ['2026-11-08T07:00:00Z', null],
    ['2026-11-06T01:01:00Z', null],
    ['2026-11-06T10:00:00Z', null],
  ])('서버 시간대와 무관하게 %s를 판정한다', (time, slot) => {
    expect(reviewReminderSlot(new Date(time))).toBe(slot);
  });

  it('종류별 대기 수와 가장 오래된 요청 시각을 표시한다', () => {
    const message = reviewMessage(
      [
        {
          type: 'STORY',
          pendingReview: 2,
          oldestSubmittedAt: new Date('2026-11-05T01:00:00Z'),
        },
        {
          type: 'POSTER',
          pendingReview: 3,
          oldestSubmittedAt: new Date('2026-11-06T00:00:00Z'),
        },
      ],
      new Date('2026-11-06T01:00:00Z'),
    );
    expect(message.text).toContain('5건');
    expect(message.text).toContain('포스터 3건 · 이벤트 배너 0건 · 제보 2건');
    expect(message.text).toContain('대기 24시간 0분');
  });
});
