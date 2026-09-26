import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/types/auth-user.js';
import { isReviewer } from '../auth/types/role.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { decodeCursor } from '../common/pagination/cursor.js';
import { toPage, type Page } from '../common/pagination/page.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { auditLogs, submissions, users } from '../db/schema.js';
import type {
  AuditLogDto,
  ListAuditLogsQueryDto,
} from './dto/audit-log.dto.js';

const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

/**
 * 감사 로그 조회 (요구사항 11.2). 운영자(검토자 이상)는 전체를, 신청자는 본인 신청의 로그만 본다.
 * 쓰기는 AuditService가 한다.
 */
@Injectable()
export class AuditLogsService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async list(
    user: AuthUser,
    query: ListAuditLogsQueryDto,
  ): Promise<Page<AuditLogDto>> {
    await this.assertCanView(user, query);
    const now = new Date();

    const filter = and(
      query.targetType ? eq(auditLogs.targetType, query.targetType) : undefined,
      query.targetId ? eq(auditLogs.targetId, query.targetId) : undefined,
      query.action ? eq(auditLogs.action, query.action) : undefined,
    );
    let pageFilter = filter;
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, cursorSchema);
      pageFilter = and(
        filter,
        sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${createdAt}::timestamptz, ${id}::uuid)`,
      );
    }

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ log: auditLogs, actorName: users.name })
        .from(auditLogs)
        // actor_id는 행위자 종류에 따라 형식이 달라 문자열이다. 사용자일 때만 이름을 붙인다.
        .leftJoin(
          users,
          and(
            eq(auditLogs.actorType, 'USER'),
            sql`${users.id}::text = ${auditLogs.actorId}`,
          ),
        )
        .where(pageFilter)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(query.limit + 1),
      this.db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(auditLogs)
        .where(filter),
    ]);

    return toPage(rows, {
      limit: query.limit,
      totalCount: total,
      serverTime: now,
      cursorOf: ({ log }) => [log.createdAt.toISOString(), log.id],
      map: ({ log, actorName }) => ({
        id: log.id,
        actorType: log.actorType,
        actorId: log.actorId,
        actorName,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        reason: log.reason,
        metadata: (log.metadata as Record<string, unknown> | null) ?? null,
        createdAt: log.createdAt.toISOString(),
        requestId: log.requestId,
      }),
    });
  }

  /** 검토자가 아니면 본인 신청 하나의 로그만 볼 수 있다. */
  private async assertCanView(
    user: AuthUser,
    query: ListAuditLogsQueryDto,
  ): Promise<void> {
    if (isReviewer(user.roles)) {
      return;
    }
    if (query.targetType === 'SUBMISSION' && query.targetId) {
      const [own] = await this.db
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            sql`${submissions.id}::text = ${query.targetId}`,
            eq(submissions.requesterId, user.id),
          ),
        );
      if (own) {
        return;
      }
    }
    throw new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      'Only reviewers can view audit logs other than their own submissions',
    );
  }
}
