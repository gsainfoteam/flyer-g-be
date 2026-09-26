import { encodeCursor } from './cursor.js';

/** 목록 응답 봉투 (프론트 API 요구사항 1.1) */
export type Page<T> = {
  items: T[];
  /** 다음 페이지가 없으면 null */
  nextCursor: string | null;
  totalCount: number;
  /** 상태·기간 판정의 기준 시각. 클라이언트 시계 대신 이 값을 쓴다 */
  serverTime: string;
};

/**
 * `limit + 1`개를 조회한 결과로 한 페이지를 만든다.
 * 한 개가 더 있으면 다음 페이지가 있다는 뜻이고, 그 앞 항목의 정렬 키가 cursor가 된다.
 */
export function toPage<Row, Item>(
  rows: Row[],
  options: {
    limit: number;
    totalCount: number;
    serverTime: Date;
    /** 다음 페이지 조회에 쓸 정렬 키. 보통 [정렬 컬럼 값, id] */
    cursorOf: (row: Row) => unknown;
    map: (row: Row) => Item;
  },
): Page<Item> {
  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
  const last = pageRows.at(-1);

  return {
    items: pageRows.map(options.map),
    nextCursor:
      hasMore && last !== undefined
        ? encodeCursor(options.cursorOf(last))
        : null,
    totalCount: options.totalCount,
    serverTime: options.serverTime.toISOString(),
  };
}
