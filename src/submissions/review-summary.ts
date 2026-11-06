import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../db/index.js';
import { submissions } from '../db/schema.js';

/** 검토 대기열과 리마인드의 공통 기준. 재신청은 마지막 검토 요청부터 기다린다. */
export const waitingSince = sql<Date>`coalesce(${submissions.submittedAt}, ${submissions.createdAt})`;

export async function pendingReviewSummary(
  db: Database | Transaction,
  filter?: SQL,
) {
  return db
    .select({
      type: submissions.type,
      pendingReview: count(),
      oldestSubmittedAt: sql<Date>`min(${waitingSince})`.mapWith(
        submissions.submittedAt,
      ),
    })
    .from(submissions)
    .where(and(filter, eq(submissions.status, 'PENDING_REVIEW')))
    .groupBy(submissions.type);
}
