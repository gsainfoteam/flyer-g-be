import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, asc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { auditLogs, userRoles, users } from '../src/db/schema.js';
import { ROLE_LOCK } from '../src/users/user-roles.service.js';
import { createTestUser, type TestUser } from './helpers/test-user.js';

type AdminUser = {
  id: string;
  name: string;
  email: string;
  studentId: string | null;
  grantedRoles: string[];
  lastLoginAt: string;
  createdAt: string;
};

describe('사용자 역할 관리 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let admin: TestUser;
  let reviewer: TestUser;
  let submitter: TestUser;
  const created: TestUser[] = [];
  // 다른 테스트·로컬 데이터의 이름과 겹치지 않게 붙인다
  const tag = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // 파일 동안 포트를 하나로 고정한다. supertest가 요청마다 서버를 열고 닫으면
    // 동시 요청 중 하나가 닫힌 서버에 걸려 끊긴다(socket hang up).
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);

    admin = await createUser({ roles: ['SUPER_ADMIN'] });
    reviewer = await createUser({ roles: ['REVIEWER'] });
    submitter = await createUser();
  });

  afterAll(async () => {
    for (const user of created) {
      await user.remove();
    }
    await app.close();
  });

  const server = () => app.getHttpServer();

  async function createUser(
    options: Parameters<typeof createTestUser>[1] & { name?: string } = {},
  ): Promise<TestUser> {
    const user = await createTestUser(app, options);
    created.push(user);
    if (options.name) {
      await db
        .update(users)
        .set({ name: options.name })
        .where(eq(users.id, user.user.id));
    }
    return user;
  }

  const list = (query: string, user = admin) =>
    request(server())
      .get(`/signage/users${query}`)
      .set('Authorization', user.authHeader);

  const grant = (id: string, role: string, user = admin) =>
    request(server())
      .put(`/signage/users/${id}/roles/${role}`)
      .set('Authorization', user.authHeader);

  const revoke = (id: string, role: string, user = admin) =>
    request(server())
      .delete(`/signage/users/${id}/roles/${role}`)
      .set('Authorization', user.authHeader);

  /** 검토자 이상만 볼 수 있는 API로 실제 권한을 확인한다 */
  const canReview = async (user: TestUser) =>
    (
      await request(server())
        .get('/signage/devices')
        .set('Authorization', user.authHeader)
    ).status === 200;

  const rolesInDb = async (id: string) =>
    (
      await db
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, id))
        .orderBy(asc(userRoles.role))
    ).map((row) => row.role);

  const roleLogsOf = (id: string) =>
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, 'USER'), eq(auditLogs.targetId, id)))
      .orderBy(asc(auditLogs.createdAt));

  /** 역할 변경 잠금을 기다리는 트랜잭션이 count개가 될 때까지 기다린다 */
  async function waitForLockWaiters(count: number): Promise<void> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const [{ waiting }] = await db.execute<{ waiting: number }>(
        sql`select count(*)::int as waiting from pg_locks
            where locktype = 'advisory' and not granted
              and classid = ${ROLE_LOCK.namespace} and objid = ${ROLE_LOCK.key}`,
      );
      if (waiting >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `역할 변경 잠금을 기다리는 요청이 ${count}개가 되지 않았다`,
    );
  }

  describe('권한', () => {
    it('로그인이 필요하다', async () => {
      const id = submitter.user.id;
      await request(server()).get('/signage/users').expect(401);
      await request(server())
        .put(`/signage/users/${id}/roles/REVIEWER`)
        .expect(401);
      await request(server())
        .delete(`/signage/users/${id}/roles/REVIEWER`)
        .expect(401);
    });

    it('SUPER_ADMIN만 쓸 수 있다', async () => {
      for (const user of [reviewer, submitter]) {
        expect((await list('', user)).status).toBe(403);
        expect((await grant(submitter.user.id, 'REVIEWER', user)).status).toBe(
          403,
        );
        expect((await revoke(reviewer.user.id, 'REVIEWER', user)).status).toBe(
          403,
        );
      }
      // 본인에게 SUPER_ADMIN을 주는 것도 막힌다
      expect(
        (await grant(reviewer.user.id, 'SUPER_ADMIN', reviewer)).status,
      ).toBe(403);
      expect(await rolesInDb(reviewer.user.id)).toEqual(['REVIEWER']);
      expect(await rolesInDb(submitter.user.id)).toEqual([]);
    });
  });

  describe('목록', () => {
    it('이름·이메일·학번으로 찾고, 부여된 역할만 준다', async () => {
      const kim = await createUser({
        name: `E2E 김 ${tag}`,
        roles: ['REVIEWER', 'SUPER_ADMIN'],
      });
      const lee = await createUser({ name: `E2E 이 ${tag}` });

      const res = await list(`?q=${encodeURIComponent(tag)}`).expect(200);
      expect(res.body.totalCount).toBe(2);
      expect(res.body.items).toEqual([
        {
          id: kim.user.id,
          name: `E2E 김 ${tag}`,
          email: 'e2e@test.local',
          studentId: null,
          grantedRoles: ['REVIEWER', 'SUPER_ADMIN'],
          lastLoginAt: expect.any(String),
          createdAt: expect.any(String),
        },
        expect.objectContaining({ id: lee.user.id, grantedRoles: [] }),
      ]);
      // 내부 식별자는 주지 않는다
      expect(res.body.items[0]).not.toHaveProperty('idpUuid');

      const studentId = `S${randomUUID().slice(0, 8)}`;
      await db
        .update(users)
        .set({ studentId })
        .where(eq(users.id, lee.user.id));
      const byStudentId = await list(`?q=${studentId}`).expect(200);
      expect(byStudentId.body.items.map((u: AdminUser) => u.id)).toEqual([
        lee.user.id,
      ]);
    });

    it('역할로 거르고, cursor로 다음 페이지를 준다', async () => {
      const q = `?q=${encodeURIComponent(`페이지 ${tag}`)}`;
      const first = await createUser({
        name: `E2E 페이지 ${tag} 1`,
        roles: ['REVIEWER'],
      });
      const second = await createUser({
        name: `E2E 페이지 ${tag} 2`,
        roles: ['REVIEWER'],
      });
      await createUser({ name: `E2E 페이지 ${tag} 3` });

      const reviewers = await list(`${q}&role=REVIEWER&limit=1`).expect(200);
      expect(reviewers.body.totalCount).toBe(2);
      expect(reviewers.body.items.map((u: AdminUser) => u.id)).toEqual([
        first.user.id,
      ]);
      const next = await list(
        `${q}&role=REVIEWER&limit=1&cursor=${reviewers.body.nextCursor}`,
      ).expect(200);
      expect(next.body.items.map((u: AdminUser) => u.id)).toEqual([
        second.user.id,
      ]);
      expect(next.body.nextCursor).toBeNull();
    });

    it('검색어의 %와 _는 글자 그대로 찾는다', async () => {
      const percent = await createUser({ name: `E2E ${tag} 100%` });
      await createUser({ name: `E2E ${tag} 1000` });
      const underscore = await createUser({ name: `E2E ${tag}_x` });
      await createUser({ name: `E2E ${tag}ax` });

      const byPercent = await list(
        `?q=${encodeURIComponent(`${tag} 100%`)}`,
      ).expect(200);
      expect(byPercent.body.items.map((u: AdminUser) => u.id)).toEqual([
        percent.user.id,
      ]);
      const byUnderscore = await list(
        `?q=${encodeURIComponent(`${tag}_`)}`,
      ).expect(200);
      expect(byUnderscore.body.items.map((u: AdminUser) => u.id)).toEqual([
        underscore.user.id,
      ]);
    });

    it('형식이 틀린 필터는 422, cursor는 400', async () => {
      await list(`?q=${'a'.repeat(101)}`).expect(422);
      await list('?role=SUBMITTER').expect(422);
      await list('?limit=0').expect(422);
      await list('?cursor=broken').expect(400);
    });
  });

  describe('부여·회수', () => {
    it('부여하면 바로 권한이 생기고, 회수하면 바로 없어진다', async () => {
      const target = await createUser({ name: `E2E 대상 ${tag}` });
      expect(await canReview(target)).toBe(false);

      const granted = await grant(target.user.id, 'REVIEWER').expect(200);
      expect(granted.body).toMatchObject({
        id: target.user.id,
        grantedRoles: ['REVIEWER'],
      });
      // 토큰을 새로 받지 않아도 된다
      expect(await canReview(target)).toBe(true);

      await revoke(target.user.id, 'REVIEWER').expect(204);
      expect(await rolesInDb(target.user.id)).toEqual([]);
      expect(await canReview(target)).toBe(false);

      const logs = await roleLogsOf(target.user.id);
      expect(
        logs.map(({ action, actorId, metadata }) => ({
          action,
          actorId,
          metadata,
        })),
      ).toEqual([
        {
          action: 'USER_ROLE_GRANTED',
          actorId: admin.user.id,
          metadata: { role: 'REVIEWER' },
        },
        {
          action: 'USER_ROLE_REVOKED',
          actorId: admin.user.id,
          metadata: { role: 'REVIEWER' },
        },
      ]);
    });

    it('같은 요청을 다시 보내도 결과가 같고, 감사 로그는 한 번만 남는다', async () => {
      const target = await createUser();

      await grant(target.user.id, 'REVIEWER').expect(200);
      const again = await grant(target.user.id, 'REVIEWER').expect(200);
      expect(again.body.grantedRoles).toEqual(['REVIEWER']);
      await revoke(target.user.id, 'REVIEWER').expect(204);
      await revoke(target.user.id, 'REVIEWER').expect(204);

      expect(
        (await roleLogsOf(target.user.id)).map((log) => log.action),
      ).toEqual(['USER_ROLE_GRANTED', 'USER_ROLE_REVOKED']);
    });

    it('SUPER_ADMIN도 부여할 수 있고, 받은 사람은 바로 역할을 관리할 수 있다', async () => {
      const target = await createUser();
      const other = await createUser();

      await grant(target.user.id, 'SUPER_ADMIN').expect(200);
      await grant(other.user.id, 'REVIEWER', target).expect(200);
      expect(await rolesInDb(other.user.id)).toEqual(['REVIEWER']);

      await revoke(target.user.id, 'SUPER_ADMIN').expect(204);
      await grant(other.user.id, 'SUPER_ADMIN', target).expect(403);
      expect(await rolesInDb(other.user.id)).toEqual(['REVIEWER']);
    });

    it('본인의 역할은 회수할 수 없다', async () => {
      const self = await createUser({ roles: ['REVIEWER', 'SUPER_ADMIN'] });

      for (const role of ['SUPER_ADMIN', 'REVIEWER']) {
        const res = await revoke(self.user.id, role, self).expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
      expect(await rolesInDb(self.user.id)).toEqual([
        'REVIEWER',
        'SUPER_ADMIN',
      ]);
      expect(await roleLogsOf(self.user.id)).toEqual([]);
    });

    it('두 관리자가 동시에 서로를 회수하면 한쪽만 성공한다', async () => {
      const a = await createUser({ roles: ['SUPER_ADMIN'] });
      const b = await createUser({ roles: ['SUPER_ADMIN'] });

      // 역할 변경 잠금을 먼저 잡아, 두 요청이 모두 권한 검사를 통과하고 잠금 앞에서 기다리게 만든다.
      // 요청 도착 시점에 기대지 않고 확실히 겹치게 하기 위해서다.
      let requests!: Promise<[request.Response, request.Response]>;
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${ROLE_LOCK.namespace}::int, ${ROLE_LOCK.key}::int)`,
        );
        requests = Promise.all([
          revoke(b.user.id, 'SUPER_ADMIN', a).then((res) => res),
          revoke(a.user.id, 'SUPER_ADMIN', b).then((res) => res),
        ]);
        await waitForLockWaiters(2);
      });
      const [aRevokesB, bRevokesA] = await requests;

      expect([aRevokesB.status, bRevokesA.status].sort()).toEqual([204, 403]);
      const remaining = [
        ...(await rolesInDb(a.user.id)),
        ...(await rolesInDb(b.user.id)),
      ];
      expect(remaining).toEqual(['SUPER_ADMIN']);
      const logs = [
        ...(await roleLogsOf(a.user.id)),
        ...(await roleLogsOf(b.user.id)),
      ];
      expect(logs.map((log) => log.action)).toEqual(['USER_ROLE_REVOKED']);
    });

    it('SUBMITTER나 모르는 역할은 422, 없는 사용자는 404', async () => {
      const id = submitter.user.id;
      for (const role of ['SUBMITTER', 'ADMIN', 'reviewer']) {
        const res = await grant(id, role).expect(422);
        expect(res.body.fields).toHaveProperty('role');
        await revoke(id, role).expect(422);
      }
      for (const missing of [randomUUID(), 'not-a-uuid']) {
        await grant(missing, 'REVIEWER').expect(404);
        await revoke(missing, 'REVIEWER').expect(404);
      }
      expect(await rolesInDb(id)).toEqual([]);
    });
  });

  describe('감사 로그 조회', () => {
    it('역할 변경 로그는 SUPER_ADMIN만 보고, 대상 이름을 targetTitle로 준다', async () => {
      const target = await createUser({ name: `E2E 로그 ${tag}` });
      await grant(target.user.id, 'REVIEWER').expect(200);
      const query = `?targetType=USER&targetId=${target.user.id}`;

      const res = await request(server())
        .get(`/signage/audit-logs${query}`)
        .set('Authorization', admin.authHeader)
        .expect(200);
      expect(res.body.items).toEqual([
        expect.objectContaining({
          action: 'USER_ROLE_GRANTED',
          actorId: admin.user.id,
          targetType: 'USER',
          targetId: target.user.id,
          targetTitle: `E2E 로그 ${tag}`,
          metadata: { role: 'REVIEWER' },
        }),
      ]);

      await request(server())
        .get(`/signage/audit-logs${query}`)
        .set('Authorization', reviewer.authHeader)
        .expect(403);
      // targetType 없이 요청해도 REVIEWER에게는 섞이지 않는다
      const byId = await request(server())
        .get(`/signage/audit-logs?targetId=${target.user.id}`)
        .set('Authorization', reviewer.authHeader)
        .expect(200);
      expect(byId.body.items).toEqual([]);
      expect(byId.body.totalCount).toBe(0);
      await request(server())
        .get(`/signage/audit-logs${query}`)
        .set('Authorization', submitter.authHeader)
        .expect(403);
    });
  });
});
