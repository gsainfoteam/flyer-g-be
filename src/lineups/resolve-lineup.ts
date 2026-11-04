import type { SubmissionType } from '../db/schema.js';
import type {
  BlockSchedule,
  DeviceOverrides,
  LineupSettings,
} from './lineup-schema.js';

export type LineupBlockView = {
  id: string;
  source: 'SUBMISSIONS' | 'PROGRAM';
  submissionType: SubmissionType | null;
  programId: string | null;
  durationSeconds: number;
  perVisit: number | null;
  schedule: BlockSchedule;
  enabled: boolean;
};

export type Lineup = {
  settings: LineupSettings;
  blocks: LineupBlockView[];
};

/** 그룹 설정 위에 기기 예외의 설정 키를 덮는다. */
export function resolveSettings(
  settings: LineupSettings,
  overrides: DeviceOverrides,
): LineupSettings {
  return { ...settings, ...overrides.settings };
}

/**
 * 기기가 실제로 따르는 편성. 블록 예외는 enabled·durationSeconds만 바꾼다.
 * 그룹에서 지워진 블록 id의 예외는 무시한다. 꺼진 블록도 남긴다(빼는 것은 응답을 만드는 쪽이 정한다).
 */
export function resolveLineup(
  lineup: Lineup,
  overrides: DeviceOverrides,
): Lineup {
  return {
    settings: resolveSettings(lineup.settings, overrides),
    blocks: lineup.blocks.map((block) => ({
      ...block,
      ...overrides.blocks[block.id],
    })),
  };
}

/** 그룹에 없는 블록 id와 아무것도 바꾸지 않는 블록 예외를 지운다. 저장할 때 부른다. */
export function pruneOverrides(
  overrides: DeviceOverrides,
  blockIds: ReadonlySet<string>,
): DeviceOverrides {
  return {
    settings: overrides.settings,
    blocks: Object.fromEntries(
      Object.entries(overrides.blocks).filter(
        ([id, change]) => blockIds.has(id) && Object.keys(change).length > 0,
      ),
    ),
  };
}
