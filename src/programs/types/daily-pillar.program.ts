import { z } from 'zod';
import { seoulDate } from '../../common/time/seoul-time.js';
import { strictObject } from '../../common/validation/zod.js';
import type { ProgramType } from '../program-type.js';

const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const STEMS_HANJA = [
  '甲',
  '乙',
  '丙',
  '丁',
  '戊',
  '己',
  '庚',
  '辛',
  '壬',
  '癸',
];
const BRANCHES = [
  '자',
  '축',
  '인',
  '묘',
  '진',
  '사',
  '오',
  '미',
  '신',
  '유',
  '술',
  '해',
];
const BRANCHES_HANJA = [
  '子',
  '丑',
  '寅',
  '卯',
  '辰',
  '巳',
  '午',
  '未',
  '申',
  '酉',
  '戌',
  '亥',
];
const ANIMALS = [
  '쥐',
  '소',
  '호랑이',
  '토끼',
  '용',
  '뱀',
  '말',
  '양',
  '원숭이',
  '닭',
  '개',
  '돼지',
];

/** 1970-01-01(UTC 날짜)은 육십갑자의 17번째(신사, 0부터 셈)다 */
const EPOCH_INDEX = 17;

export type DayPillar = {
  date: string;
  name: string;
  hanja: string;
  stem: string;
  branch: string;
  animal: string;
};

/** 서울 날짜(YYYY-MM-DD)의 일진. 육십갑자는 날마다 하나씩 돈다 */
export function dayPillarOf(date: string): DayPillar {
  const days = Math.round(Date.parse(date) / 86_400_000);
  const index = (((days + EPOCH_INDEX) % 60) + 60) % 60;
  const stem = index % 10;
  const branch = index % 12;
  return {
    date,
    name: `${STEMS[stem]}${BRANCHES[branch]}`,
    hanja: `${STEMS_HANJA[stem]}${BRANCHES_HANJA[branch]}`,
    stem: STEMS[stem]!,
    branch: BRANCHES[branch]!,
    animal: ANIMALS[branch]!,
  };
}

const params = strictObject({}, '오늘의 일진은 설정이 없습니다.');

/** 오늘의 일진. 서버가 서울 날짜로 계산해 data로 싣는다. 모든 TV가 같은 값을 쓴다 */
export const DAILY_PILLAR_PROGRAM: ProgramType<z.output<typeof params>> = {
  type: 'DAILY_PILLAR',
  name: '오늘의 일진',
  defaultDurationSeconds: 8,
  params,
  dataSource: 'GENERATED',
  buildData: (_params, { now }) => dayPillarOf(seoulDate(now)),
};
