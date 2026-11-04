import type { z } from 'zod';

/** 운영 컨텐츠의 data를 어디서 얻는가. 관리 화면이 종류마다 안내를 다르게 한다 */
export const PROGRAM_DATA_SOURCES = [
  'NONE',
  'COLLECTOR',
  'DATASET',
  'GENERATED',
] as const;
export type ProgramDataSource = (typeof PROGRAM_DATA_SOURCES)[number];

export const DATA_STATES = ['OK', 'STALE', 'FAILING', 'EMPTY'] as const;
export type DataState = (typeof DATA_STATES)[number];

/** 운영 컨텐츠 목록 한 줄에 쓰는 데이터 상태 (FE 요청 5-2) */
export type DataStatus = {
  state: DataState;
  detail: string;
  updatedAt: string | null;
};

/** buildData·dataStatus가 받는 것. 데이터셋·수집기(⑪⑬)가 생기면 여기에 더한다 */
export type ProgramDataContext = {
  now: Date;
};

/**
 * 운영 컨텐츠 종류. 종류 하나 = 정의 파일 하나다(types/*.program.ts, program-types.ts에 한 줄).
 * type은 DB에 varchar로 저장하므로 새 종류에 마이그레이션이 필요 없다.
 */
export interface ProgramType<Params = any> {
  readonly type: string;
  /** 관리 화면에 보이는 종류 이름 */
  readonly name: string;
  /** 편성 블록을 새로 만들 때 관리 화면이 넣는 길이(초) */
  readonly defaultDurationSeconds: number;
  /** params의 모양. 관리 화면 폼(paramsSchema)도 여기서 만든다 */
  readonly params: z.ZodType<Params>;
  readonly dataSource: ProgramDataSource;
  /** 정보줄에서 이 종류가 맡는 칸. 없으면 정보줄에 못 쓴다 (FE 7-1) */
  readonly infoBarItem?: string;
  /** 편성 응답 programs[id].data. 없으면 data는 null이다 */
  buildData?(params: Params, ctx: ProgramDataContext): Record<string, unknown>;
  /** 운영 컨텐츠 목록의 dataStatus. 없으면 null이다 */
  dataStatus?(params: Params, ctx: ProgramDataContext): DataStatus;
}
