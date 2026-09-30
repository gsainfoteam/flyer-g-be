import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/types/auth-user.js';
import { isReviewer } from '../auth/types/role.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { decodeCursor } from '../common/pagination/cursor.js';
import { toPage, type Page } from '../common/pagination/page.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import {
  auditLogs,
  devices,
  submissions,
  targetGroups,
  users,
} from '../db/schema.js';
import type { AuditTargetType } from './audit.service.js';
import type {
  AuditLogDto,
  ListAuditLogsQueryDto,
} from './dto/audit-log.dto.js';

const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);
const uuidSchema = z.uuid();

type AuditLogRow = typeof auditLogs.$inferSelect;

/**
 * 감사 로그 조회 (요구사항 11.2). 운영자(검토자 이상)는 전체를, 신청자는 본인 신청의 로그만 본다.
 * 사용자 역할 변경(USER) 로그는 SUPER_ADMIN만 본다.
 * 쓰기는 AuditService가 한다.
 */
@Injectable()
export class AuditLogsService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async list(
    user: AuthUser,
    query: ListAuditLogsQueryDto,
  ): Promise<Page<AuditLogDto>> {
    const visible = await this.visibleTo(user, query);
    const now = new Date();

    const filter = and(
      visible,
      query.targetType ? eq(auditLogs.targetType, query.targetType) : undefined,
      query.targetId ? eq(auditLogs.targetId, query.targetId) : undefined,
      query.action ? inArray(auditLogs.action, query.action) : undefined,
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
    const titles = await this.targetTitlesOf(rows.map(({ log }) => log));

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
        targetTitle: titles.get(titleKey(log)) ?? null,
        reason: log.reason,
        metadata: (log.metadata as Record<string, unknown> | null) ?? null,
        createdAt: log.createdAt.toISOString(),
        requestId: log.requestId,
      }),
    });
  }

  /**
   * 대상의 현재 표시 이름 (신청 제목, 기기 이름, 그룹 이름, 사용자 이름). 로그를 쓸 때가 아니라 지금 값이다.
   * target_id는 문자열이라 JOIN하면 uuid 인덱스를 못 쓰므로, 페이지를 받은 뒤 종류별로 한 번씩 찾는다.
   */
  private async targetTitlesOf(
    logs: AuditLogRow[],
  ): Promise<Map<string, string>> {
    const idsOf = (type: AuditTargetType) => [
      ...new Set(
        logs
          .filter((log) => log.targetType === type)
          .map((log) => log.targetId),
      ),
    ];
    // 신청·기기·사용자 ID는 uuid 컬럼이라 형식이 틀린 값을 넘기면 쿼리가 실패한다.
    const uuidsOf = (type: AuditTargetType) =>
      idsOf(type).filter((id) => uuidSchema.safeParse(id).success);
    const submissionIds = uuidsOf('SUBMISSION');
    const deviceIds = uuidsOf('DEVICE');
    const groupIds = idsOf('GROUP');
    const userIds = uuidsOf('USER');

    const [submissionRows, deviceRows, groupRows, userRows] = await Promise.all(
      [
        submissionIds.length
          ? this.db
              .select({ id: submissions.id, title: submissions.title })
              .from(submissions)
              .where(inArray(submissions.id, submissionIds))
          : [],
        deviceIds.length
          ? this.db
              .select({ id: devices.id, title: devices.name })
              .from(devices)
              .where(inArray(devices.id, deviceIds))
          : [],
        groupIds.length
          ? this.db
              .select({ id: targetGroups.id, title: targetGroups.name })
              .from(targetGroups)
              .where(inArray(targetGroups.id, groupIds))
          : [],
        userIds.length
          ? this.db
              .select({ id: users.id, title: users.name })
              .from(users)
              .where(inArray(users.id, userIds))
          : [],
      ],
    );

    const titles = new Map<string, string>();
    for (const [targetType, rows] of [
      ['SUBMISSION', submissionRows],
      ['DEVICE', deviceRows],
      ['GROUP', groupRows],
      ['USER', userRows],
    ] as const) {
      for (const row of rows) {
        titles.set(titleKey({ targetType, targetId: row.id }), row.title);
      }
    }
    return titles;
  }

  /**
   * SUPER_ADMIN은 전체를, REVIEWER는 사용자 역할 변경(USER)을 뺀 전체를 본다.
   * 누가 관리자인지는 역할을 관리하는 사람만 알면 되기 때문이다.
   * 그 외 사용자는 본인 신청의 로그만 본다:
   * targetId를 주면 그 신청이 본인 것인지 확인하고, 비우면 본인 신청 전체로 좁힌다.
   * 돌려준 조건은 목록과 건수 모두에 붙는다.
   */
  private async visibleTo(
    user: AuthUser,
    query: ListAuditLogsQueryDto,
  ): Promise<SQL | undefined> {
    if (user.roles.includes('SUPER_ADMIN')) {
      return undefined;
    }
    if (isReviewer(user.roles)) {
      if (query.targetType === 'USER') {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Only super admins can view user role logs',
        );
      }
      return ne(auditLogs.targetType, 'USER');
    }
    if (query.targetType === 'SUBMISSION' && !query.targetId) {
      return inArray(
        auditLogs.targetId,
        this.db
          .select({ id: sql<string>`${submissions.id}::text` })
          .from(submissions)
          .where(eq(submissions.requesterId, user.id)),
      );
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
        return undefined;
      }
    }
    throw new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      'Only reviewers can view audit logs other than their own submissions',
    );
  }
}

function titleKey(log: Pick<AuditLogRow, 'targetType' | 'targetId'>): string {
  return `${log.targetType}:${log.targetId}`;
}
