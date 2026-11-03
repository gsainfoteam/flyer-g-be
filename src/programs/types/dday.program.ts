import { z } from 'zod';
import { strictObject } from '../../common/validation/zod.js';
import { seoulDate } from '../../common/time/seoul-time.js';
import type { ProgramType } from '../program-type.js';

/** 공통: 짧은 이름과 서울 날짜 */
export const labelSchema = (title: string) =>
  z
    .string(`${title}을 입력하세요.`)
    .trim()
    .min(1, `${title}을 입력하세요.`)
    .max(20, `${title}은 20자까지입니다.`)
    .meta({ title });

export const dateSchema = (title: string) =>
  z.iso.date(`${title}는 YYYY-MM-DD 형식이어야 합니다.`).meta({ title });

const params = strictObject(
  { label: labelSchema('이름'), date: dateSchema('날짜') },
  'D-day 설정이 올바르지 않습니다.',
);

/** 날짜가 지나면 운영자가 정리하도록 STALE로 알린다 */
export function ddayStatus(date: string, now: Date) {
  const today = seoulDate(now);
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (days < 0) {
    return {
      state: 'STALE' as const,
      detail: `날짜가 ${-days}일 지났습니다`,
      updatedAt: null,
    };
  }
  return {
    state: 'OK' as const,
    detail: days === 0 ? 'D-day' : `D-${days}`,
    updatedAt: null,
  };
}

/** D-day. 정보줄 DDAY 칸에 쓴다. 남은 날은 TV가 서울 날짜로 센다 */
export const DDAY_PROGRAM: ProgramType<z.output<typeof params>> = {
  type: 'DDAY',
  name: 'D-day',
  defaultDurationSeconds: 5,
  params,
  dataSource: 'NONE',
  infoBarItem: 'DDAY',
  dataStatus: (value, { now }) => ddayStatus(value.date, now),
};
