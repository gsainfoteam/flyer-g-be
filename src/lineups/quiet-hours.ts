import { seoulMinuteOfDay } from '../common/time/seoul-time.js';
import type { LineupSettings } from './lineup-schema.js';

const minutesOf = (clock: string) => {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * 지금이 화면 끔 시간인가(서울 기준). 구간은 start 이상 end 미만이다.
 * end가 start보다 이르면 자정을 넘는 구간이다(22:00–06:00).
 */
export function isQuietAt(
  quietHours: LineupSettings['quietHours'],
  now: Date,
): boolean {
  const minute = seoulMinuteOfDay(now);
  return quietHours.some((range) => {
    const start = minutesOf(range.start);
    const end = minutesOf(range.end);
    return start < end
      ? start <= minute && minute < end
      : minute >= start || minute < end;
  });
}
