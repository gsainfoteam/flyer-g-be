/**
 * DB 테이블 정의. 이 파일이 스키마의 유일한 기준(single source of truth)이다.
 *
 * 테이블을 추가/수정한 뒤 `bun run db:generate`를 실행하면
 * drizzle/ 폴더에 마이그레이션 SQL이 생성된다.
 * 그 SQL은 앱이 시작될 때 자동으로 실행된다(src/db/db.module.ts 참고).
 *
 * 예시:
 *
 * import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
 *
 * export const flyers = pgTable('flyers', {
 *   id: uuid('id').primaryKey().defaultRandom(),
 *   title: varchar('title', { length: 255 }).notNull(),
 *   createdAt: timestamp('created_at').notNull().defaultNow(),
 * });
 */

export {};
