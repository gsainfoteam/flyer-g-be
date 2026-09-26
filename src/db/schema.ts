/**
 * DB 테이블 정의. 이 파일이 스키마의 유일한 기준(single source of truth)이다.
 *
 * 테이블을 추가/수정한 뒤 `bun run db:generate`를 실행하면
 * drizzle/ 폴더에 마이그레이션 SQL이 생성된다.
 * 그 SQL은 앱이 시작될 때 자동으로 실행된다(src/db/db.module.ts 참고).
 */

import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * 따로 부여하는 역할. SUBMITTER는 로그인한 모든 사용자가 기본으로 가지므로
 * 저장하지 않는다(src/auth/types/role.ts 참고).
 * 부여는 당분간 DB에 직접 INSERT 한다.
 */
export const grantedRoleEnum = pgEnum('granted_role', [
  'REVIEWER',
  'SUPER_ADMIN',
]);

/** Infoteam IdP로 로그인한 사용자. 첫 로그인 때 생성되고 로그인마다 갱신된다. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // IdP의 sub. 사용자를 식별하는 기준 값이다.
  idpUuid: varchar('idp_uuid', { length: 255 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  studentId: varchar('student_id', { length: 32 }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: grantedRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

export const idempotencyStatusEnum = pgEnum('idempotency_status', [
  'IN_PROGRESS',
  'COMPLETED',
]);

/**
 * Idempotency-Key로 받은 요청의 처리 상태와 성공 응답.
 * 같은 key의 재시도에는 저장된 응답을 그대로 돌려준다(src/common/idempotency).
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    // key를 보낸 주체. 'user:<users.id>' 형식이라 다른 사용자의 응답을 받을 수 없다.
    scope: varchar('scope', { length: 64 }).notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    // method + path + body의 sha256. 같은 key로 다른 요청을 보내면 거절한다.
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    status: idempotencyStatusEnum('status').notNull(),
    responseBody: jsonb('response_body'),
    // 처리 중인 요청이 이 시각까지 끝나지 않으면 죽은 것으로 보고 다른 요청이 넘겨받는다.
    lockedUntil: timestamp('locked_until', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key] }),
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
  ],
);

export type User = typeof users.$inferSelect;
export type GrantedRole = (typeof grantedRoleEnum.enumValues)[number];
