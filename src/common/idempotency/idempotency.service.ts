import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../../db/index.js';
import { idempotencyKeys } from '../../db/schema.js';

export type ClaimResult =
  /** 이 요청이 처리 권한을 얻었다. 끝나면 complete 또는 release를 불러야 한다 */
  | { kind: 'claimed' }
  /** 이미 성공한 요청이다. 저장된 응답을 돌려준다 */
  | { kind: 'completed'; body: unknown }
  /** 같은 key의 요청이 처리 중이다. 기다렸다가 다시 claim한다 */
  | { kind: 'in_progress' }
  /** 같은 key로 내용이 다른 요청을 보냈다 */
  | { kind: 'mismatch' };

// 처리 중인 요청이 이 시간 안에 끝나지 않으면(파드가 죽는 등) 다음 재시도가 넘겨받는다.
const LOCK_TTL = sql.raw(`interval '30 seconds'`);
// 성공 응답을 기억하는 기간. 프론트 재시도는 이보다 훨씬 짧은 간격으로 일어난다.
const RETENTION = sql.raw(`interval '24 hours'`);

/**
 * Idempotency-Key 저장소. 선점(INSERT … ON CONFLICT)으로 같은 key의 동시 요청 중
 * 하나만 처리하게 한다. 처리 중에 DB 커넥션을 잡고 있지 않도록 row lock 대신
 * 상태 컬럼과 만료 시각을 쓴다.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async claim(
    scope: string,
    key: string,
    fingerprint: string,
  ): Promise<ClaimResult> {
    const t = idempotencyKeys;

    // 새 key이거나, 보관 기간이 지났거나, 같은 요청의 처리자가 죽었으면 선점한다.
    const [claimed] = await this.db
      .insert(t)
      .values({
        scope,
        key,
        fingerprint,
        status: 'IN_PROGRESS',
        lockedUntil: sql`now() + ${LOCK_TTL}`,
        expiresAt: sql`now() + ${RETENTION}`,
      })
      .onConflictDoUpdate({
        target: [t.scope, t.key],
        set: {
          fingerprint: sql`excluded.fingerprint`,
          status: 'IN_PROGRESS',
          responseBody: null,
          lockedUntil: sql`excluded.locked_until`,
          expiresAt: sql`excluded.expires_at`,
          createdAt: sql`now()`,
        },
        setWhere: sql`${t.expiresAt} < now() OR (${t.status} = 'IN_PROGRESS' AND ${t.lockedUntil} < now() AND ${t.fingerprint} = excluded.fingerprint)`,
      })
      .returning({ scope: t.scope });
    if (claimed) {
      return { kind: 'claimed' };
    }

    const [existing] = await this.db
      .select({
        fingerprint: t.fingerprint,
        status: t.status,
        responseBody: t.responseBody,
      })
      .from(t)
      .where(and(eq(t.scope, scope), eq(t.key, key)));

    // 그 사이 처리자가 실패해 지웠다. 다시 선점을 시도하게 한다.
    if (!existing) {
      return { kind: 'in_progress' };
    }
    if (existing.fingerprint !== fingerprint) {
      return { kind: 'mismatch' };
    }
    if (existing.status === 'COMPLETED') {
      return { kind: 'completed', body: existing.responseBody };
    }
    return { kind: 'in_progress' };
  }

  async complete(scope: string, key: string, body: unknown): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({ status: 'COMPLETED', responseBody: body ?? null })
      .where(
        and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)),
      );
  }

  /** 처리에 실패하면 기록을 지워 같은 key로 다시 시도할 수 있게 한다. */
  async release(scope: string, key: string): Promise<void> {
    await this.db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.status, 'IN_PROGRESS'),
        ),
      );
  }
}
