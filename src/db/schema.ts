/**
 * DB 테이블 정의. 이 파일이 스키마의 유일한 기준(single source of truth)이다.
 *
 * 테이블을 추가/수정한 뒤 `bun run db:generate`를 실행하면
 * drizzle/ 폴더에 마이그레이션 SQL이 생성된다.
 * 그 SQL은 앱이 시작될 때 자동으로 실행된다(src/db/db.module.ts 참고).
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
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

/**
 * 관리 화면 없이 DB에 직접 넣는 참조 데이터(카테고리·대상 그룹)는
 * 사람이 읽을 수 있는 slug를 ID로 쓴다. 예: performance, grp_house_a
 */
const SLUG_PATTERN = '^[a-z][a-z0-9_]{0,63}$';

/** 게시물 분류. 신청 폼의 선택지이자 TV에 표시되는 분류명이다. */
export const categories = pgTable(
  'categories',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 50 }).notNull(),
    // 오름차순으로 노출한다.
    sortOrder: integer('sort_order').notNull().default(0),
    // 이미 쓰인 카테고리는 지우지 않고 숨긴다. 기존 신청은 그대로 이 카테고리를 가리킨다.
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'categories_id_format',
      sql`${table.id} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`,
    ),
  ],
);

/** 게시 대상 위치 묶음(예: 학사기숙사 A동). 기기와 신청이 그룹을 가리킨다. */
export const targetGroups = pgTable(
  'target_groups',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'target_groups_id_format',
      sql`${table.id} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`,
    ),
  ],
);

export const assetStatusEnum = pgEnum('asset_status', [
  // 서명 URL을 발급했고 브라우저 업로드를 기다린다
  'PENDING_UPLOAD',
  // 검증과 변형 이미지 생성을 마쳤다. 신청에 쓸 수 있다
  'READY',
  // 형식·크기·해상도 검증에 실패했다. 원본은 지웠다
  'REJECTED',
]);

/**
 * 업로드한 포스터 이미지. 원본은 uploads/<id>(비공개)에 받아 검증한 뒤 지우고,
 * EXIF를 뺀 변형 이미지만 assets/<id>/<variant>.webp(공개)에 남긴다.
 * 내용이 바뀌지 않으므로 포스터를 바꾸려면 새 asset을 만든다.
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: assetStatusEnum('status').notNull().default('PENDING_UPLOAD'),

    // presign 요청에서 사용자가 알려 준 값. 서명 URL 조건과 완료 시 대조에 쓴다.
    fileName: varchar('file_name', { length: 255 }).notNull(),
    declaredMimeType: varchar('declared_mime_type', { length: 50 }).notNull(),
    declaredSizeBytes: integer('declared_size_bytes').notNull(),
    declaredChecksum: varchar('declared_checksum', { length: 71 }),
    uploadExpiresAt: timestamp('upload_expires_at', {
      withTimezone: true,
    }).notNull(),

    // 완료 처리에서 파일 내용으로 판별한 값 (READY일 때 채워진다)
    mimeType: varchar('mime_type', { length: 50 }),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes'),
    // sha256:<hex>. TV 미디어 캐시 key이자 승인 시 고정하는 값
    checksum: varchar('checksum', { length: 71 }),
    // REJECTED일 때 사용자에게 보여 줄 사유
    rejectionReason: varchar('rejection_reason', { length: 255 }),
    processedAt: timestamp('processed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('assets_owner_id_idx').on(table.ownerId),
    // 신청되지 않은 채 남은 업로드를 정리할 때 쓴다 (Phase 8)
    index('assets_status_created_at_idx').on(table.status, table.createdAt),
  ],
);

export type Asset = typeof assets.$inferSelect;

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
