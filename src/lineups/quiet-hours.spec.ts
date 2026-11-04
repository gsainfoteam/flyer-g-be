import { isQuietAt } from './quiet-hours.js';

const kst = (time: string) => new Date(`2026-11-02T${time}:00+09:00`);

describe('isQuietAt', () => {
  it('구간은 start 이상 end 미만이다', () => {
    const hours = [{ start: '02:00', end: '06:00' }];
    expect(isQuietAt(hours, kst('01:59'))).toBe(false);
    expect(isQuietAt(hours, kst('02:00'))).toBe(true);
    expect(isQuietAt(hours, kst('05:59'))).toBe(true);
    expect(isQuietAt(hours, kst('06:00'))).toBe(false);
  });

  it('end가 start보다 이르면 자정을 넘는다', () => {
    const hours = [{ start: '22:00', end: '06:00' }];
    expect(isQuietAt(hours, kst('21:59'))).toBe(false);
    expect(isQuietAt(hours, kst('23:30'))).toBe(true);
    expect(isQuietAt(hours, kst('00:00'))).toBe(true);
    expect(isQuietAt(hours, kst('05:59'))).toBe(true);
    expect(isQuietAt(hours, kst('06:00'))).toBe(false);
  });

  it('서울 시각으로 본다', () => {
    // 2026-11-01T17:30Z = 서울 11-02 02:30
    expect(
      isQuietAt(
        [{ start: '02:00', end: '06:00' }],
        new Date('2026-11-01T17:30:00Z'),
      ),
    ).toBe(true);
  });

  it('여러 구간 중 하나라도 들면 끔', () => {
    const hours = [
      { start: '02:00', end: '03:00' },
      { start: '12:00', end: '13:00' },
    ];
    expect(isQuietAt(hours, kst('12:30'))).toBe(true);
    expect(isQuietAt(hours, kst('09:00'))).toBe(false);
    expect(isQuietAt([], kst('12:30'))).toBe(false);
  });
});
