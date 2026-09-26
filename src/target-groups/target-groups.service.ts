import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { targetGroups } from '../db/schema.js';

export type TargetGroupSummary = {
  id: string;
  name: string;
  deviceCount: number;
};

@Injectable()
export class TargetGroupsService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** 신청 폼에 노출할 대상 위치 그룹. 숨긴 그룹은 뺀다. */
  async findActive(): Promise<TargetGroupSummary[]> {
    const rows = await this.db
      .select({ id: targetGroups.id, name: targetGroups.name })
      .from(targetGroups)
      .where(eq(targetGroups.isActive, true))
      .orderBy(asc(targetGroups.sortOrder), asc(targetGroups.id));

    // 기기 테이블은 Phase 5(기기 등록)에서 생긴다. 그때 그룹별 기기 수를 센다.
    return rows.map((row) => ({ ...row, deviceCount: 0 }));
  }

  /** 주어진 ID 중 없거나 숨긴 그룹 */
  async findUnavailable(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db
      .select({ id: targetGroups.id })
      .from(targetGroups)
      .where(
        and(inArray(targetGroups.id, ids), eq(targetGroups.isActive, true)),
      );
    const available = new Set(rows.map((row) => row.id));
    return ids.filter((id) => !available.has(id));
  }
}
