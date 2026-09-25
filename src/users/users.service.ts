import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { userRoles, users, type GrantedRole, type User } from '../db/schema.js';
import type { IdpUserInfo } from '../idp/idp.types.js';

export type UserWithRoles = User & { grantedRoles: GrantedRole[] };

@Injectable()
export class UsersService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * IdP 사용자 정보로 사용자를 만들거나 갱신한다.
   * 이름·이메일은 IdP가 기준이므로 로그인할 때마다 덮어쓴다.
   */
  async upsertFromIdp(info: IdpUserInfo): Promise<User> {
    const now = new Date();
    const [user] = await this.db
      .insert(users)
      .values({
        idpUuid: info.uuid,
        email: info.email,
        name: info.name,
        studentId: info.studentId ?? null,
        lastLoginAt: now,
      })
      .onConflictDoUpdate({
        target: users.idpUuid,
        set: {
          email: info.email,
          name: info.name,
          studentId: info.studentId ?? null,
          lastLoginAt: now,
          updatedAt: now,
        },
      })
      .returning();
    return user;
  }

  async findByIdWithRoles(id: string): Promise<UserWithRoles | null> {
    const rows = await this.db
      .select({ user: users, role: userRoles.role })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .where(eq(users.id, id));

    if (rows.length === 0) {
      return null;
    }
    return {
      ...rows[0].user,
      grantedRoles: rows.flatMap((row) => (row.role ? [row.role] : [])),
    };
  }
}
