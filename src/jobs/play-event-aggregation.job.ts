import { Inject, Injectable } from '@nestjs/common';
import { eq, gt, sql } from 'drizzle-orm';
import {
  addSeoulDays,
  seoulDate,
  startOfSeoulDay,
} from '../common/time/seoul-time.js';
import { DB_CONNECTION, type Database, type Transaction } from '../db/index.js';
import { jobWatermarks, playEventDaily, playEvents } from '../db/schema.js';
import { JobLock, withJobLock } from './job-lock.js';

export const PLAY_EVENT_WATERMARK = 'play-event-daily';
/** 원본 노출 이벤트 보관 기간(일). 집계는 계속 남는다. */
export const PLAY_EVENT_RETENTION_DAYS = 90;
// 수신 시각은 앱 시계로 넣고 커밋은 조금 뒤에 된다. 경계에서 놓치지 않도록 앞 실행과 겹쳐 본다.
const WATERMARK_OVERLAP_MS = 5 * 60 * 1000;
// 한 번에 지우는 원본 수. 남은 것은 다음 실행에서 지운다.
const RETENTION_BATCH = 50_000;

// started_at의 서울 날짜
const seoulDay = sql`(${playEvents.startedAt} at time zone 'Asia/Seoul')::date`;

export type PlayEventAggregationResult = {
  daysRecomputed: number;
  rawDeleted: number;
};

/**
 * 노출 이벤트를 (서울 날짜, 게시물, 기기)별로 집계하고, 보관 기간이 지난 원본을 지운다.
 *
 * 지난 실행 이후 새로 들어온 이벤트가 있는 날짜만 원본에서 통째로 다시 계산한다.
 * - 오프라인이던 기기가 며칠 치 이벤트를 늦게 보내도 그 날짜들이 다시 계산된다
 * - 같은 날짜를 여러 번 계산해도 결과가 같다 (지우고 다시 넣는다)
 * - 원본이 일부 지워진 날짜(보관 기간 경계 밖)는 다시 계산하지 않는다
 */
@Injectable()
export class PlayEventAggregationJob {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  run(now = new Date()): Promise<PlayEventAggregationResult | null> {
    return withJobLock(this.db, JobLock.PLAY_EVENT_AGGREGATION, async (tx) => {
      const retentionStartDay = addSeoulDays(
        seoulDate(now),
        -PLAY_EVENT_RETENTION_DAYS,
      );

      const [watermark] = await tx
        .select({ value: jobWatermarks.value })
        .from(jobWatermarks)
        .where(eq(jobWatermarks.name, PLAY_EVENT_WATERMARK));
      const since = watermark
        ? new Date(watermark.value.getTime() - WATERMARK_OVERLAP_MS)
        : new Date(0);

      const touched = await tx
        .selectDistinct({ day: sql<string>`${seoulDay}::text` })
        .from(playEvents)
        .where(gt(playEvents.receivedAt, since));
      const days = touched
        .map((row) => row.day)
        .filter((day) => day >= retentionStartDay)
        .sort();

      if (days.length > 0) {
        await this.recompute(tx, days, now);
      }
      const rawDeleted = await this.deleteExpired(
        tx,
        startOfSeoulDay(retentionStartDay),
      );

      await tx
        .insert(jobWatermarks)
        .values({ name: PLAY_EVENT_WATERMARK, value: now, updatedAt: now })
        .onConflictDoUpdate({
          target: jobWatermarks.name,
          set: { value: now, updatedAt: now },
        });

      return { daysRecomputed: days.length, rawDeleted };
    });
  }

  private async recompute(
    tx: Transaction,
    days: string[],
    now: Date,
  ): Promise<void> {
    const dayList = sql.join(
      days.map((day) => sql`${day}::date`),
      sql`, `,
    );
    // 범위 조건은 started_at 인덱스를 타기 위한 것이다. 정확한 날짜 판정은 seoulDay로 한다.
    // 날 SQL에는 Date를 그대로 넘길 수 없어 ISO 문자열 + 형 변환으로 넘긴다.
    const from = startOfSeoulDay(days[0]);
    const to = startOfSeoulDay(addSeoulDays(days[days.length - 1], 1));

    await tx
      .delete(playEventDaily)
      .where(sql`${playEventDaily.day} in (${dayList})`);
    await tx.execute(sql`
      insert into ${playEventDaily}
        (day, submission_id, device_id, impressions, completed_impressions, total_duration_ms, updated_at)
      select ${seoulDay}, ${playEvents.submissionId}, ${playEvents.deviceId},
             count(*), count(*) filter (where ${playEvents.completed}),
             coalesce(sum(${playEvents.durationMs}), 0), ${now.toISOString()}::timestamptz
      from ${playEvents}
      where ${playEvents.startedAt} >= ${from.toISOString()}::timestamptz
        and ${playEvents.startedAt} < ${to.toISOString()}::timestamptz
        and ${seoulDay} in (${dayList})
      group by 1, 2, 3
    `);
  }

  /** 보관 기간이 지난 원본을 나눠 지운다. 그 날짜들의 집계는 이미 끝났다. */
  private async deleteExpired(tx: Transaction, before: Date): Promise<number> {
    const [row] = await tx.execute<{ deleted: number }>(sql`
      with doomed as (
        select ctid from ${playEvents}
        where ${playEvents.startedAt} < ${before.toISOString()}::timestamptz
        limit ${RETENTION_BATCH}
      ), deleted as (
        delete from ${playEvents} where ctid in (select ctid from doomed)
        returning 1
      )
      select count(*)::int as deleted from deleted
    `);
    return row?.deleted ?? 0;
  }
}
