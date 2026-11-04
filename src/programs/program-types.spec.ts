import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createProgramSchema } from './program-schema.js';
import {
  dataStatusOf,
  INFO_BAR_ITEMS,
  PROGRAM_TYPES,
  programDataOf,
} from './program-types.js';
import { dayPillarOf } from './types/daily-pillar.program.js';
import { ddayStatus } from './types/dday.program.js';

const issuesOf = (result: { error?: z.ZodError }) =>
  result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]);

describe('운영 컨텐츠 레지스트리', () => {
  it('종류 이름과 정보줄 칸은 겹치지 않고, params는 폼용 JSON Schema로 바뀐다', () => {
    const types = PROGRAM_TYPES.map((definition) => definition.type);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(INFO_BAR_ITEMS).size).toBe(INFO_BAR_ITEMS.length);
    for (const definition of PROGRAM_TYPES) {
      expect(definition.type).toMatch(/^[A-Z][A-Z0-9_]{0,31}$/);
      const schema = z.toJSONSchema(definition.params, {
        target: 'openapi-3.0',
        io: 'input',
      });
      expect(schema).toMatchObject({ type: 'object' });
    }
  });

  it('지금 종류는 DDAY·EXAM_CHEER·DAILY_PILLAR·CLICK_BATTLE이고 정보줄 칸은 DDAY 하나다', () => {
    expect(PROGRAM_TYPES.map((definition) => definition.type)).toEqual([
      'DDAY',
      'EXAM_CHEER',
      'DAILY_PILLAR',
      'CLICK_BATTLE',
    ]);
    expect(INFO_BAR_ITEMS).toEqual(['DDAY']);
  });
});

describe('createProgramSchema', () => {
  it('종류마다 params를 그 종류 모양으로 검증한다', () => {
    expect(
      issuesOf(
        createProgramSchema.safeParse({
          type: 'DDAY',
          name: ' ',
          params: { label: '', date: '12/15', extra: 1 },
        }),
      ),
    ).toEqual([
      ['name', '이름을 입력하세요.'],
      ['params.label', '이름을 입력하세요.'],
      ['params.date', '날짜는 YYYY-MM-DD 형식이어야 합니다.'],
      ['params', '알 수 없는 항목이 있습니다: extra'],
    ]);
    expect(
      issuesOf(
        createProgramSchema.safeParse({
          type: 'CLICK_BATTLE',
          name: '점심 배틀',
          params: { rounds: 11 },
        }),
      ),
    ).toEqual([['params.rounds', '판 수는 10 이하여야 합니다.']]);
    expect(
      issuesOf(createProgramSchema.safeParse({ type: 'NOPE', name: 'x' })),
    ).toEqual([
      [
        'type',
        '운영 컨텐츠 종류가 올바르지 않습니다. (DDAY, EXAM_CHEER, DAILY_PILLAR, CLICK_BATTLE)',
      ],
    ]);
  });

  it('이름은 앞뒤 공백을 빼고, 빈 응원 문구는 null로 둔다', () => {
    expect(
      createProgramSchema.parse({
        type: 'EXAM_CHEER',
        name: ' 수능 응원 ',
        params: { label: '수능', date: '2026-11-19', message: '' },
      }),
    ).toEqual({
      type: 'EXAM_CHEER',
      name: '수능 응원',
      params: { label: '수능', date: '2026-11-19', message: null },
    });
  });
});

describe('dayPillarOf', () => {
  it('잘 알려진 날의 일진과 맞다', () => {
    expect(dayPillarOf('1900-01-01').hanja).toBe('甲戌');
    expect(dayPillarOf('2000-01-01')).toEqual({
      date: '2000-01-01',
      name: '무오',
      hanja: '戊午',
      stem: '무',
      branch: '오',
      animal: '말',
    });
    // 60일마다 돈다
    expect(dayPillarOf('2000-03-01').name).toBe('무오');
  });
});

describe('data와 dataStatus', () => {
  // 서울 2026-11-03 09:00
  const now = new Date('2026-11-03T00:00:00.000Z');

  it('D-day는 남은 날을, 지나면 STALE을 알린다', () => {
    expect(ddayStatus('2026-11-15', now)).toMatchObject({
      state: 'OK',
      detail: 'D-12',
    });
    expect(ddayStatus('2026-11-03', now).detail).toBe('D-day');
    expect(ddayStatus('2026-11-01', now)).toMatchObject({
      state: 'STALE',
      detail: '날짜가 2일 지났습니다',
    });
  });

  it('일진은 서울 날짜로 data를 만들고, data가 없는 종류는 null이다', () => {
    // UTC로는 11월 2일이지만 서울은 11월 3일이다
    const lateUtc = new Date('2026-11-02T16:00:00.000Z');
    expect(
      programDataOf({ type: 'DAILY_PILLAR', params: {} }, { now: lateUtc }),
    ).toMatchObject({ date: '2026-11-03' });
    expect(
      programDataOf(
        { type: 'DDAY', params: { label: '기말', date: '2026-12-15' } },
        { now },
      ),
    ).toBeNull();
    expect(dataStatusOf({ type: 'DAILY_PILLAR', params: {} }, { now })).toBe(
      null,
    );
  });

  it('저장된 params가 지금 정의와 맞지 않으면 data는 null, 상태는 FAILING이다', () => {
    const stale = { type: 'DDAY', params: { label: '기말' } };
    expect(programDataOf(stale, { now })).toBeNull();
    expect(dataStatusOf(stale, { now })?.state).toBe('FAILING');
    expect(dataStatusOf({ type: 'GONE', params: {} }, { now })?.state).toBe(
      'FAILING',
    );
  });
});
