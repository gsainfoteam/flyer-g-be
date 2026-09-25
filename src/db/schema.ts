/**
 * DB 테이블 정의. 이 파일이 스키마의 유일한 기준(single source of truth)이다.
 *
 * 테이블을 추가/수정한 뒤 `bun run db:generate`를 실행하면
 * drizzle/ 폴더에 마이그레이션 SQL이 생성된다.
 * 그 SQL은 앱이 시작될 때 자동으로 실행된다(src/db/db.module.ts 참고).
 */

import {
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

export type User = typeof users.$inferSelect;
export type GrantedRole = (typeof grantedRoleEnum.enumValues)[number];
