import type {
  DataStatus,
  ProgramDataContext,
  ProgramType,
} from './program-type.js';
import { CLICK_BATTLE_PROGRAM } from './types/click-battle.program.js';
import { DAILY_PILLAR_PROGRAM } from './types/daily-pillar.program.js';
import { DDAY_PROGRAM } from './types/dday.program.js';
import { EXAM_CHEER_PROGRAM } from './types/exam-cheer.program.js';

/**
 * 운영 컨텐츠 종류 레지스트리. 종류를 더하면 정의 파일을 만들고 이 배열에 한 줄 더한다.
 * 관리 화면 순서도 이 순서다.
 */
export const PROGRAM_TYPES: readonly ProgramType[] = [
  DDAY_PROGRAM,
  EXAM_CHEER_PROGRAM,
  DAILY_PILLAR_PROGRAM,
  CLICK_BATTLE_PROGRAM,
];

export const PROGRAM_TYPE_NAMES = PROGRAM_TYPES.map(
  (definition) => definition.type,
);

/** 정보줄에 쓸 수 있는 칸. 종류의 infoBarItem에서 모은다 (FE 7-1) */
export const INFO_BAR_ITEMS = PROGRAM_TYPES.flatMap((definition) =>
  definition.infoBarItem ? [definition.infoBarItem] : [],
);

export function programTypeOf(type: string): ProgramType | undefined {
  return PROGRAM_TYPES.find((definition) => definition.type === type);
}

/** 이 종류가 들어갈 수 있는 정보줄 칸. 정보줄에 쓸 수 없는 종류면 undefined */
export function infoBarItemOf(type: string): string | undefined {
  return programTypeOf(type)?.infoBarItem;
}

type StoredProgram = { type: string; params: unknown };

/**
 * 저장된 params를 지금 종류 정의로 다시 읽는다. 종류가 없어졌거나 모양이 바뀌어
 * 맞지 않으면 null이다(저장할 때 검증했으므로 정의가 바뀐 경우뿐이다).
 */
function parsedOf(program: StoredProgram) {
  const definition = programTypeOf(program.type);
  const parsed = definition?.params.safeParse(program.params);
  return definition && parsed?.success
    ? { definition, params: parsed.data }
    : null;
}

/** 편성 응답 programs[id].data. 만들 것이 없는 종류는 null */
export function programDataOf(
  program: StoredProgram,
  ctx: ProgramDataContext,
): Record<string, unknown> | null {
  const parsed = parsedOf(program);
  return parsed?.definition.buildData?.(parsed.params, ctx) ?? null;
}

/** 운영 컨텐츠 목록의 dataStatus. 상태를 따로 알릴 것이 없는 종류는 null */
export function dataStatusOf(
  program: StoredProgram,
  ctx: ProgramDataContext,
): DataStatus | null {
  const parsed = parsedOf(program);
  if (!parsed) {
    return {
      state: 'FAILING',
      detail: '설정이 지금 종류와 맞지 않습니다. 다시 저장하세요',
      updatedAt: null,
    };
  }
  return parsed.definition.dataStatus?.(parsed.params, ctx) ?? null;
}
