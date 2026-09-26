import { addMonthsInSeoul } from './seoul-time.js';

const kst = (iso: string) => new Date(`${iso}+09:00`);

describe('addMonthsInSeoul', () => {
  it.each([
    ['2026-03-15T10:00:00', 3, '2026-06-15T10:00:00'],
    ['2026-11-20T00:00:00', 3, '2027-02-20T00:00:00'],
    // 말일 보정
    ['2026-01-31T10:00:00', 1, '2026-02-28T10:00:00'],
    ['2028-01-31T10:00:00', 1, '2028-02-29T10:00:00'],
    ['2026-05-31T23:59:59', 1, '2026-06-30T23:59:59'],
  ])('%s KST + %i개월 = %s KST', (from, months, to) => {
    expect(addMonthsInSeoul(kst(from), months).toISOString()).toBe(
      kst(to).toISOString(),
    );
  });

  it('UTC로는 전날이어도 서울 날짜 기준으로 계산한다', () => {
    // 2026-01-31 00:30 KST = 2026-01-30 15:30 UTC. UTC 기준이면 2월 28일이 아니라 3월 2일이 된다.
    expect(addMonthsInSeoul(kst('2026-01-31T00:30:00'), 1).toISOString()).toBe(
      kst('2026-02-28T00:30:00').toISOString(),
    );
  });
});
