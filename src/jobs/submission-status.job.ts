import { Inject, Injectable } from '@nestjs/common';
import { and, gt, inArray, lte, sql } from 'drizzle-orm';
import { AuditService, type AuditAction } from '../audit/audit.service.js';
import { DB_CONNECTION, type Database, type Transaction } from '../db/index.js';
import { submissions, type SubmissionStatus } from '../db/schema.js';
import { JobLock, withJobLock } from './job-lock.js';

export type StatusSyncResult = {
  scheduled: number;
  published: number;
  ended: number;
};

/**
 * 저장된 상태를 기간에 맞춘다. 편성·요약·취소 판정은 이미 기간으로 하므로 이 작업이 늦어도
 * 동작은 맞다. 이 작업은 목록의 상태 탭과 상태별 건수가 실제와 맞도록 하기 위한 것이다.
 */
@Injectable()
export class SubmissionStatusJob {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
  ) {}

  run(now = new Date()): Promise<StatusSyncResult | null> {
    return withJobLock(this.db, JobLock.SUBMISSION_STATUS, async (tx) => {
      // 끝난 것부터 처리해야 기간이 지난 건이 PUBLISHED로 잘못 가지 않는다.
      const ended = await this.move(
        tx,
        now,
        'ENDED',
        'SUBMISSION_ENDED',
        and(
          inArray(submissions.status, ['APPROVED', 'SCHEDULED', 'PUBLISHED']),
          lte(submissions.endAt, now),
        ),
      );
      const published = await this.move(
        tx,
        now,
        'PUBLISHED',
        'SUBMISSION_PUBLISHED',
        and(
          inArray(submissions.status, ['APPROVED', 'SCHEDULED']),
          lte(submissions.startAt, now),
          gt(submissions.endAt, now),
        ),
      );
      const scheduled = await this.move(
        tx,
        now,
        'SCHEDULED',
        'SUBMISSION_SCHEDULED',
        and(
          inArray(submissions.status, ['APPROVED']),
          gt(submissions.startAt, now),
        ),
      );
      return { scheduled, published, ended };
    });
  }

  /** 상태를 바꾸고 version을 올린다. 사용자가 본 화면이 낡았으면 다음 요청이 409가 된다. */
  private async move(
    tx: Transaction,
    now: Date,
    status: SubmissionStatus,
    action: AuditAction,
    where: ReturnType<typeof and>,
  ): Promise<number> {
    const moved = await tx
      .update(submissions)
      .set({
        status,
        version: sql`${submissions.version} + 1`,
        updatedAt: now,
      })
      .where(where)
      .returning({ id: submissions.id });

    for (const { id } of moved) {
      await this.auditService.record(tx, {
        actor: { type: 'SYSTEM', id: null },
        action,
        target: { type: 'SUBMISSION', id },
        metadata: { toStatus: status },
        at: now,
      });
    }
    return moved.length;
  }
}
