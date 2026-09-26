import {
  addMonthsInSeoul,
  addSeoulDays,
  seoulDate,
  startOfSeoulDay,
} from './seoul-time.js';

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

describe('seoulDate / startOfSeoulDay / addSeoulDays', () => {
  it('UTC로 전날 15시 이후는 서울로 다음 날이다', () => {
    expect(seoulDate(new Date('2026-09-20T14:59:59.999Z'))).toBe('2026-09-20');
    expect(seoulDate(new Date('2026-09-20T15:00:00.000Z'))).toBe('2026-09-21');
  });

  it('서울 날짜의 시작은 UTC 전날 15시다', () => {
    expect(startOfSeoulDay('2026-09-21').toISOString()).toBe(
      '2026-09-20T15:00:00.000Z',
    );
  });

  it('날짜를 더하고 빼며 달·해를 넘긴다', () => {
    expect(addSeoulDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addSeoulDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addSeoulDays('2026-09-27', -89)).toBe('2026-06-30');
  });
});
