import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../../src/db/index.js';
import {
  assets,
  submissions,
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
 * 테스트가 끝나면 remove()로 지운다. 신청은 사용자 삭제로 연쇄 삭제되지 않아 먼저 지운다.
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
      await db.delete(submissions).where(eq(submissions.requesterId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    },
  };
}

/** 다른 테스트·로컬 데이터와 겹치지 않는 slug ID */
export function uniqueSlug(prefix: string): string {
  return `${prefix}_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

/** S3 없이 쓸 수 있는, 업로드·검증이 끝난 asset */
export async function createReadyAsset(
  app: INestApplication,
  ownerId: string,
): Promise<string> {
  const db = app.get<Database>(DB_CONNECTION);
  const [asset] = await db
    .insert(assets)
    .values({
      ownerId,
      status: 'READY',
      fileName: 'poster.jpg',
      declaredMimeType: 'image/jpeg',
      declaredSizeBytes: 2048,
      uploadExpiresAt: new Date(),
      mimeType: 'image/jpeg',
      width: 1536,
      height: 2048,
      sizeBytes: 2048,
      checksum: `sha256:${'0'.repeat(64)}`,
      processedAt: new Date(),
    })
    .returning({ id: assets.id });
  return asset.id;
}
