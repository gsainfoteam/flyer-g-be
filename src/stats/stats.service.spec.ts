import { AppException } from '../common/errors/app.exception.js';
import { resolveRange } from './stats.service.js';

// 2026-09-27 01:00 KST
const NOW = new Date('2026-09-26T16:00:00.000Z');

function fieldsOf(run: () => unknown): Record<string, string> | undefined {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return (error as AppException).fields;
  }
  throw new Error('예외가 나지 않았다');
}

describe('resolveRange', () => {
  it('기본은 서울 기준 오늘까지 30일', () => {
    expect(resolveRange(undefined, undefined, NOW)).toEqual({
      from: '2026-08-29',
      to: '2026-09-27',
    });
  });

  it('to만 주면 그 날까지 30일', () => {
    expect(resolveRange(undefined, '2026-03-01', NOW)).toEqual({
      from: '2026-01-31',
      to: '2026-03-01',
    });
  });

  it('하루만 볼 수 있다', () => {
    expect(resolveRange('2026-07-01', '2026-07-01', NOW)).toEqual({
      from: '2026-07-01',
      to: '2026-07-01',
    });
  });

  it('366일까지 된다', () => {
    expect(resolveRange('2025-01-01', '2026-01-01', NOW).from).toBe(
      '2025-01-01',
    );
    expect(
      fieldsOf(() => resolveRange('2025-01-01', '2026-01-02', NOW)),
    ).toEqual({ from: '기간은 최대 366일입니다.' });
  });

  it('시작이 끝보다 늦으면 422', () => {
    expect(
      fieldsOf(() => resolveRange('2026-07-02', '2026-07-01', NOW)),
    ).toEqual({ from: '시작 날짜가 끝 날짜보다 늦습니다.' });
  });

  it('없는 날짜는 422', () => {
    expect(
      fieldsOf(() => resolveRange('2026-02-30', '2026-13-01', NOW)),
    ).toEqual({ from: '없는 날짜입니다.', to: '없는 날짜입니다.' });
  });
});
