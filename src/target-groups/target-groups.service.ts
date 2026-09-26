import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { deviceTargetGroups, devices, targetGroups } from '../db/schema.js';

export type TargetGroupSummary = {
  id: string;
  name: string;
  deviceCount: number;
};

@Injectable()
export class TargetGroupsService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** 신청 폼에 노출할 대상 위치 그룹. 숨긴 그룹은 뺀다. 기기 수는 활성 기기만 센다. */
  findActive(): Promise<TargetGroupSummary[]> {
    return this.db
      .select({
        id: targetGroups.id,
        name: targetGroups.name,
        deviceCount:
          sql`count(${devices.id}) filter (where ${devices.isActive})`.mapWith(
            Number,
          ),
      })
      .from(targetGroups)
      .leftJoin(
        deviceTargetGroups,
        eq(deviceTargetGroups.targetGroupId, targetGroups.id),
      )
      .leftJoin(devices, eq(devices.id, deviceTargetGroups.deviceId))
      .where(eq(targetGroups.isActive, true))
      .groupBy(targetGroups.id)
      .orderBy(asc(targetGroups.sortOrder), asc(targetGroups.id));
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
