import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../../src/db/index.js';
import {
  userRoles,
  users,
  type GrantedRole,
  type User,
} from '../../src/db/schema.js';

export type TestUser = {
  user: User;
  /** Authorization 헤더 값 */
  authHeader: string;
  remove: () => Promise<void>;
};

/**
 * e2e용 사용자를 만들고 access token을 발급한다. IdP를 거치지 않는다.
 * 테스트가 끝나면 remove()로 지운다(역할도 함께 지워진다).
 */
export async function createTestUser(
  app: INestApplication,
  options: { roles?: GrantedRole[] } = {},
): Promise<TestUser> {
  const db = app.get<Database>(DB_CONNECTION);
  const [user] = await db
    .insert(users)
    .values({
      idpUuid: `e2e-${randomUUID()}`,
      email: 'e2e@test.local',
      name: 'E2E 사용자',
    })
    .returning();

  if (options.roles?.length) {
    await db
      .insert(userRoles)
      .values(options.roles.map((role) => ({ userId: user.id, role })));
  }
  const token = await app
    .get(JwtService, { strict: false })
    .signAsync({ sub: user.id }, { expiresIn: 600 });

  return {
    user,
    authHeader: `Bearer ${token}`,
    remove: async () => {
      await db.delete(users).where(eq(users.id, user.id));
    },
  };
}

/** 다른 테스트·로컬 데이터와 겹치지 않는 slug ID */
export function uniqueSlug(prefix: string): string {
  return `${prefix}_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
