import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/index.js';

// Postgres advisory lock 번호. 마이그레이션 잠금(src/db/index.ts)과 겹치지 않는 값이다.
const JOB_LOCK_NAMESPACE = 1179207270;

export const JobLock = {
  SUBMISSION_STATUS: 1,
  ASSET_CLEANUP: 2,
  IDEMPOTENCY_CLEANUP: 3,
} as const;

/**
 * 파드가 여러 개여도 같은 작업은 한 곳에서만 돌게 한다.
 * 잠금을 얻지 못하면(다른 파드나 이전 실행이 아직 도는 중) 건너뛰고 null을 준다.
 * 트랜잭션 단위 잠금이라 fn이 끝나면(커밋·롤백) 자동으로 풀린다.
 */
export async function withJobLock<T>(
  db: Database,
  job: (typeof JobLock)[keyof typeof JobLock],
  fn: (tx: Transaction) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${JOB_LOCK_NAMESPACE}::int, ${job}::int) as locked`,
    );
    if (!row?.locked) {
      return null;
    }
    return fn(tx);
  });
}
