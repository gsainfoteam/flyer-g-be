import {
  blockInputSchema,
  blockScheduleSchema,
  DEFAULT_LINEUP_SETTINGS,
  deviceOverridesSchema,
  lineupSettingsSchema,
} from './lineup-schema.js';

const issuesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  (result.error?.issues ?? []).map((issue) => [
    issue.path.join('.'),
    issue.message,
  ]);

describe('lineupSettingsSchema', () => {
  it('기본 설정은 유효하다', () => {
    expect(lineupSettingsSchema.parse(DEFAULT_LINEUP_SETTINGS)).toEqual(
      DEFAULT_LINEUP_SETTINGS,
    );
  });

  it('자정을 넘는 화면 끔 시간을 받는다', () => {
    const settings = {
      ...DEFAULT_LINEUP_SETTINGS,
      quietHours: [{ start: '22:00', end: '06:00' }],
    };
    expect(lineupSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it('정보줄 item은 한 번씩, 4칸까지', () => {
    const entry = (item: string) => ({ item, programId: `prg_${item}` });
    expect(
      issuesOf(
        lineupSettingsSchema.safeParse({
          ...DEFAULT_LINEUP_SETTINGS,
          infoBar: [entry('DDAY'), entry('DDAY')],
        }),
      ),
    ).toEqual([['infoBar', '같은 정보줄 항목은 한 번만 넣을 수 있습니다.']]);
    expect(
      issuesOf(
        lineupSettingsSchema.safeParse({
          ...DEFAULT_LINEUP_SETTINGS,
          infoBar: ['A', 'B', 'C', 'D', 'E'].map(entry),
        }),
      ),
    ).toEqual([['infoBar', '정보줄은 4칸까지입니다.']]);
  });
});

describe('blockScheduleSchema', () => {
  it('요일은 1~7이고 겹치지 않는다', () => {
    const result = blockScheduleSchema.safeParse({
      type: 'WINDOWS',
      windows: [
        { days: [0, 8], start: '07:00', end: '09:00' },
        { days: [1, 1], start: '07:00', end: '09:00' },
      ],
    });
    expect(issuesOf(result)).toEqual([
      ['windows.0.days.0', '요일은 1(월)~7(일)이어야 합니다.'],
      ['windows.0.days.1', '요일은 1(월)~7(일)이어야 합니다.'],
      ['windows.1.days', '같은 요일을 두 번 고를 수 없습니다.'],
    ]);
  });

  it('DATE_RANGE는 시간대가 있는 ISO 시각이다', () => {
    expect(
      blockScheduleSchema.safeParse({
        type: 'DATE_RANGE',
        from: '2026-11-02T00:00:00+09:00',
        to: '2026-11-03T00:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      issuesOf(
        blockScheduleSchema.safeParse({
          type: 'DATE_RANGE',
          from: '2026-11-02',
          to: '2026-11-03T00:00:00Z',
        }),
      ),
    ).toEqual([['from', '시작 시각이 올바르지 않습니다.']]);
  });
});

describe('blockInputSchema', () => {
  it('생략한 schedule·enabled는 기본값이다', () => {
    expect(
      blockInputSchema.parse({
        source: 'PROGRAM',
        programId: 'prg_dday',
        durationSeconds: 10,
      }),
    ).toEqual({
      source: 'PROGRAM',
      programId: 'prg_dday',
      durationSeconds: 10,
      schedule: { type: 'ALWAYS' },
      enabled: true,
    });
  });

  it('해당하지 않는 필드는 null만 받는다', () => {
    expect(
      issuesOf(
        blockInputSchema.safeParse({
          source: 'PROGRAM',
          programId: 'prg_dday',
          durationSeconds: 10,
          submissionType: 'POSTER',
        }),
      ),
    ).toEqual([
      ['submissionType', 'PROGRAM 블록은 submissionType을 쓰지 않습니다.'],
    ]);
  });
});

describe('deviceOverridesSchema', () => {
  it('비면 빈 예외다', () => {
    expect(deviceOverridesSchema.parse({})).toEqual({
      settings: {},
      blocks: {},
    });
  });

  it('블록 예외는 enabled·durationSeconds만 받는다', () => {
    expect(
      issuesOf(
        deviceOverridesSchema.safeParse({
          blocks: { blk_a: { perVisit: 1 }, nope: { enabled: true } },
        }),
      ),
    ).toEqual([
      ['blocks.blk_a', '알 수 없는 항목이 있습니다: perVisit'],
      ['blocks.nope', '블록 ID가 올바르지 않습니다.'],
    ]);
  });
});
