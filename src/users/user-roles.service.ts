import { Trace } from '@gsainfoteam/nest-observability';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { decodeCursor } from '../common/pagination/cursor.js';
import { toPage, type Page } from '../common/pagination/page.js';
import { DB_CONNECTION, type Database, type Transaction } from '../db/index.js';
import { userRoles, users, type GrantedRole, type User } from '../db/schema.js';
import type { AdminUserDto, ListUsersQueryDto } from './dto/admin-user.dto.js';

const cursorSchema = z.tuple([z.string(), z.uuid()]);

// 역할 변경 잠금 번호. 마이그레이션(src/db/index.ts)·주기 작업(src/jobs/job-lock.ts)의 잠금과 겹치지 않는다.
export const ROLE_LOCK = { namespace: 1179207271, key: 1 } as const;

/**
 * SUPER_ADMIN의 사용자 역할 관리. 사용자는 첫 로그인 때 생기므로 로그인한 적 있는 사용자에게만 부여할 수 있다.
 * 역할은 요청마다 DB에서 읽으므로(JwtAuthGuard) 부여·회수는 대상의 다음 요청부터 바로 반영된다.
 */
@Trace()
@Injectable()
export class UserRolesService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<Page<AdminUserDto>> {
    const now = new Date();
    const filter = and(
      query.q ? matches(query.q) : undefined,
      query.role
        ? exists(
            this.db
              .select({ one: sql`1` })
              .from(userRoles)
              .where(
                and(
                  eq(userRoles.userId, users.id),
                  eq(userRoles.role, query.role),
                ),
              ),
          )
        : undefined,
    );
    let pageFilter = filter;
    if (query.cursor) {
      const [name, id] = decodeCursor(query.cursor, cursorSchema);
      pageFilter = and(
        filter,
        sql`(${users.name}, ${users.id}) > (${name}, ${id}::uuid)`,
      );
    }

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(pageFilter)
        .orderBy(asc(users.name), asc(users.id))
        .limit(query.limit + 1),
      this.db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(users)
        .where(filter),
    ]);
    const roles = await this.rolesOf(rows.map((user) => user.id));

    return toPage(rows, {
      limit: query.limit,
      totalCount: total,
      serverTime: now,
      cursorOf: (user) => [user.name, user.id],
      map: (user) => toDto(user, roles.get(user.id) ?? []),
    });
  }

  /** 이미 가진 역할이면 아무것도 바꾸지 않고 감사 로그도 남기지 않는다. */
  async grant(
    admin: AuthUser,
    userId: string,
    role: GrantedRole,
  ): Promise<AdminUserDto> {
    const now = new Date();
    await this.withRoleLock(admin, async (tx) => {
      await assertUserExists(tx, userId);
      const granted = await tx
        .insert(userRoles)
        .values({ userId, role, createdAt: now })
        .onConflictDoNothing()
        .returning({ role: userRoles.role });
      if (granted.length === 0) {
        return;
      }
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'USER_ROLE_GRANTED',
        target: { type: 'USER', id: userId },
        metadata: { role },
        at: now,
      });
    });
    return this.findOne(userId);
  }

  /**
   * 본인의 역할은 회수할 수 없다(실수로 관리 권한을 잃지 않게). 다른 SUPER_ADMIN이 회수한다.
   * 없는 역할이면 아무것도 바꾸지 않고 감사 로그도 남기지 않는다.
   */
  async revoke(
    admin: AuthUser,
    userId: string,
    role: GrantedRole,
  ): Promise<void> {
    if (userId === admin.id) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Cannot revoke your own role',
      );
    }

    const now = new Date();
    await this.withRoleLock(admin, async (tx) => {
      await assertUserExists(tx, userId);
      const revoked = await tx
        .delete(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)))
        .returning({ role: userRoles.role });
      if (revoked.length === 0) {
        return;
      }
      // 요청자가 SUPER_ADMIN이고 본인은 회수할 수 없으니 0명이 될 수 없다.
      // 위 규칙이 바뀌어도 관리자가 모두 사라지지 않게 한 번 더 막는다(던지면 롤백된다).
      if (role === 'SUPER_ADMIN' && !(await hasSuperAdmin(tx))) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'Cannot revoke the last super admin',
        );
      }
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'USER_ROLE_REVOKED',
        target: { type: 'USER', id: userId },
        metadata: { role },
        at: now,
      });
    });
  }

  private async findOne(userId: string): Promise<AdminUserDto> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!user) {
      throw notFound();
    }
    const roles = await this.rolesOf([user.id]);
    return toDto(user, roles.get(user.id) ?? []);
  }

  private async rolesOf(
    userIds: string[],
  ): Promise<Map<string, GrantedRole[]>> {
    const roles = new Map<string, GrantedRole[]>();
    if (userIds.length === 0) {
      return roles;
    }
    const rows = await this.db
      .select({ userId: userRoles.userId, role: userRoles.role })
      .from(userRoles)
      .where(inArray(userRoles.userId, userIds))
      .orderBy(asc(userRoles.role));
    for (const row of rows) {
      roles.set(row.userId, [...(roles.get(row.userId) ?? []), row.role]);
    }
    return roles;
  }

  /**
   * 역할 변경을 한 번에 하나씩 처리한다. 잠금을 얻은 뒤 요청자가 아직 SUPER_ADMIN인지 다시 확인한다.
   * RolesGuard는 요청 시작 때의 역할을 보므로 그 사이 다른 관리자가 요청자의 SUPER_ADMIN을 회수했을 수 있다.
   * 그래서 두 관리자가 동시에 서로를 회수해도 먼저 처리된 쪽만 성공하고 다른 쪽은 403이다.
   */
  private withRoleLock(
    admin: AuthUser,
    change: (tx: Transaction) => Promise<void>,
  ): Promise<void> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${ROLE_LOCK.namespace}::int, ${ROLE_LOCK.key}::int)`,
      );
      const [stillAdmin] = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, admin.id),
            eq(userRoles.role, 'SUPER_ADMIN'),
          ),
        );
      if (!stillAdmin) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Insufficient role',
        );
      }
      await change(tx);
    });
  }
}

/** 이름·이메일·학번 부분 일치. 검색어의 %, _, \는 글자 그대로 찾도록 이스케이프한다. */
function matches(q: string): SQL | undefined {
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return or(
    ilike(users.name, pattern),
    ilike(users.email, pattern),
    ilike(users.studentId, pattern),
  );
}

async function assertUserExists(
  tx: Transaction,
  userId: string,
): Promise<void> {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) {
    throw notFound();
  }
}

async function hasSuperAdmin(tx: Transaction): Promise<boolean> {
  const [row] = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.role, 'SUPER_ADMIN'))
    .limit(1);
  return row !== undefined;
}

function toDto(user: User, grantedRoles: GrantedRole[]): AdminUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    studentId: user.studentId,
    grantedRoles,
    lastLoginAt: user.lastLoginAt.toISOString(),
    createdAt: user.createdAt.toISOString(),
  };
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'User not found',
  );
}
