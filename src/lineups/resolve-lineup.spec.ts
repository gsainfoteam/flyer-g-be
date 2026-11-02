import { DEFAULT_LINEUP_SETTINGS } from './lineup-schema.js';
import {
  pruneOverrides,
  resolveLineup,
  resolveSettings,
  type Lineup,
  type LineupBlockView,
} from './resolve-lineup.js';

const block = (overrides: Partial<LineupBlockView> = {}): LineupBlockView => ({
  id: 'blk_posters',
  source: 'SUBMISSIONS',
  submissionType: 'POSTER',
  programId: null,
  durationSeconds: 60,
  perVisit: 3,
  schedule: { type: 'ALWAYS' },
  enabled: true,
  ...overrides,
});

const lineup: Lineup = {
  settings: DEFAULT_LINEUP_SETTINGS,
  blocks: [block(), block({ id: 'blk_story', submissionType: 'STORY' })],
};

describe('resolveSettings', () => {
  it('예외에 있는 키만 덮는다', () => {
    expect(
      resolveSettings(DEFAULT_LINEUP_SETTINGS, {
        settings: { posterLayout: 'STRIP', quietHours: [] },
        blocks: {},
      }),
    ).toEqual({ ...DEFAULT_LINEUP_SETTINGS, posterLayout: 'STRIP' });
  });

  it('배열 설정은 통째로 바꾼다', () => {
    const settings = {
      ...DEFAULT_LINEUP_SETTINGS,
      quietHours: [{ start: '02:00', end: '06:00' }],
    };
    expect(
      resolveSettings(settings, {
        settings: { quietHours: [] },
        blocks: {},
      }).quietHours,
    ).toEqual([]);
  });
});

describe('resolveLineup', () => {
  it('블록 예외는 enabled·durationSeconds만 바꾸고 순서를 지킨다', () => {
    const resolved = resolveLineup(lineup, {
      settings: {},
      blocks: {
        blk_story: { enabled: false },
        blk_posters: { durationSeconds: 30 },
      },
    });
    expect(resolved.blocks).toEqual([
      block({ durationSeconds: 30 }),
      block({ id: 'blk_story', submissionType: 'STORY', enabled: false }),
    ]);
  });

  it('그룹에 없는 블록의 예외는 무시한다', () => {
    const resolved = resolveLineup(lineup, {
      settings: {},
      blocks: { blk_gone: { enabled: false } },
    });
    expect(resolved).toEqual(lineup);
  });
});

describe('pruneOverrides', () => {
  it('없는 블록 id와 빈 블록 예외를 지운다. settings는 그대로', () => {
    const settings = { rotationSeconds: 20 };
    expect(
      pruneOverrides(
        {
          settings,
          blocks: {
            blk_posters: { enabled: false },
            blk_story: {},
            blk_gone: { durationSeconds: 10 },
          },
        },
        new Set(['blk_posters', 'blk_story']),
      ),
    ).toEqual({ settings, blocks: { blk_posters: { enabled: false } } });
  });
});
