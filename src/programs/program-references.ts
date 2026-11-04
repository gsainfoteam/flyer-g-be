import { inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../db/index.js';
import {
  devices,
  groupLineups,
  lineupBlocks,
  liveStates,
  type LiveScope,
} from '../db/schema.js';

/** 운영 컨텐츠를 쓰는 곳. 이것이 비어 있어야 지울 수 있다 */
export type ProgramUsage = {
  /** 편성 블록이나 그룹 정보줄이 가리키는 그룹 */
  usedByGroupIds: string[];
  /** 기기 예외 정보줄이 가리키는 기기 */
  usedByDeviceIds: string[];
};

const EMPTY_USAGE: ProgramUsage = { usedByGroupIds: [], usedByDeviceIds: [] };

/** jsonb 정보줄 배열에 이 운영 컨텐츠들 중 하나가 있는가 */
function infoBarContainsAny(infoBar: SQL, programIds: string[]): SQL {
  return or(
    ...programIds.map(
      (id) => sql`${infoBar} @> ${JSON.stringify([{ programId: id }])}::jsonb`,
    ),
  )!;
}

/**
 * 운영 컨텐츠를 가리키는 세 곳(계획 1-5)을 한 번에 찾는다: 편성 블록, 그룹 정보줄, 기기 예외 정보줄.
 * 삭제(IN_USE)와 목록의 usedBy, 변경 알림이 모두 이 함수를 쓴다.
 * 라이브는 삭제를 막지 않으므로 여기에 넣지 않는다(liveScopesUsing).
 */
export async function programUsageOf(
  db: Database | Transaction,
  programIds: string[],
): Promise<Map<string, ProgramUsage>> {
  const usage = new Map<string, ProgramUsage>(
    programIds.map((id) => [id, { usedByGroupIds: [], usedByDeviceIds: [] }]),
  );
  if (programIds.length === 0) {
    return usage;
  }
  const groupInfoBar = sql`${groupLineups.settings} -> 'infoBar'`;
  const deviceInfoBar = sql`${devices.lineupOverrides} -> 'settings' -> 'infoBar'`;
  const [blockRows, groupRows, deviceRows] = await Promise.all([
    db
      .selectDistinct({
        programId: lineupBlocks.programId,
        groupId: lineupBlocks.groupId,
      })
      .from(lineupBlocks)
      .where(inArray(lineupBlocks.programId, programIds)),
    db
      .select({ groupId: groupLineups.groupId, infoBar: groupInfoBar })
      .from(groupLineups)
      .where(infoBarContainsAny(groupInfoBar, programIds)),
    db
      .select({ deviceId: devices.id, infoBar: deviceInfoBar })
      .from(devices)
      .where(infoBarContainsAny(deviceInfoBar, programIds)),
  ]);

  const add = (
    programId: string,
    key: keyof ProgramUsage,
    id: string,
  ): void => {
    const entry = usage.get(programId);
    if (entry && !entry[key].includes(id)) {
      entry[key].push(id);
    }
  };
  for (const row of blockRows) {
    add(row.programId!, 'usedByGroupIds', row.groupId);
  }
  for (const row of groupRows) {
    for (const entry of infoBarOf(row.infoBar)) {
      add(entry.programId, 'usedByGroupIds', row.groupId);
    }
  }
  for (const row of deviceRows) {
    for (const entry of infoBarOf(row.infoBar)) {
      add(entry.programId, 'usedByDeviceIds', row.deviceId);
    }
  }
  for (const entry of usage.values()) {
    entry.usedByGroupIds.sort();
    entry.usedByDeviceIds.sort();
  }
  return usage;
}

export async function programUsage(
  db: Database | Transaction,
  programId: string,
): Promise<ProgramUsage> {
  return (await programUsageOf(db, [programId])).get(programId) ?? EMPTY_USAGE;
}

export function isUsed(usage: ProgramUsage): boolean {
  return usage.usedByGroupIds.length > 0 || usage.usedByDeviceIds.length > 0;
}

/** 라이브 SHOW가 이 운영 컨텐츠를 띄우는 범위. 바뀌면 그 TV에 알린다 */
export async function liveScopesUsing(
  db: Database | Transaction,
  programId: string,
): Promise<{ scope: LiveScope; scopeId: string }[]> {
  return db
    .select({ scope: liveStates.scope, scopeId: liveStates.scopeId })
    .from(liveStates)
    .where(sql`${liveStates.main} ->> 'programId' = ${programId}`);
}

function infoBarOf(value: unknown): { programId: string }[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is { programId: string } =>
          typeof entry?.programId === 'string',
      )
    : [];
}
