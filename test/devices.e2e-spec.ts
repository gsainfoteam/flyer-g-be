import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { asc, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { auditLogs, devices, targetGroups } from '../src/db/schema.js';
import {
  createTestUser,
  type TestUser,
  uniqueSlug,
} from './helpers/test-user.js';

describe('기기 등록과 인증 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let admin: TestUser;
  let reviewer: TestUser;
  let submitter: TestUser;
  const groupId = uniqueSlug('grp');
  const hiddenGroupId = uniqueSlug('grp');
  const createdDeviceIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // 파일 동안 포트를 하나로 고정한다. supertest가 요청마다 서버를 열고 닫으면
    // 동시 요청 중 하나가 닫힌 서버에 걸려 끊긴다(socket hang up).
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);

    await db.insert(targetGroups).values([
      { id: groupId, name: 'E2E 기기 그룹' },
      { id: hiddenGroupId, name: 'E2E 숨김', isActive: false },
    ]);
    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    submitter = await createTestUser(app);
  });

  afterAll(async () => {
    if (createdDeviceIds.length > 0) {
      await db
        .delete(auditLogs)
        .where(inArray(auditLogs.targetId, createdDeviceIds));
      await db.delete(devices).where(inArray(devices.id, createdDeviceIds));
    }
    await db
      .delete(targetGroups)
      .where(inArray(targetGroups.id, [groupId, hiddenGroupId]));
    for (const user of [admin, reviewer, submitter]) {
      await user.remove();
    }
    await app.close();
  });

  const server = () => app.getHttpServer();

  async function register(body: object = {}) {
    const res = await request(server())
      .post('/signage/devices')
      .set('Authorization', admin.authHeader)
      .send({ name: 'E2E 로비 TV', groupIds: [groupId], ...body })
      .expect(201);
    createdDeviceIds.push(res.body.id);
    return res.body as { id: string; token: string; tokenIssuedAt: string };
  }

  const session = (deviceId: string, token?: string) => {
    const req = request(server()).get(`/signage/devices/${deviceId}/session`);
    return token ? req.set('X-Device-Token', token) : req;
  };

  const patch = (id: string, body: object) =>
    request(server())
      .patch(`/signage/devices/${id}`)
      .set('Authorization', admin.authHeader)
      .send(body);

  describe('등록', () => {
    it('기본 설정으로 등록하고 토큰 원문을 한 번 준다', async () => {
      const res = await request(server())
        .post('/signage/devices')
        .set('Authorization', admin.authHeader)
        .send({
          name: '  E2E 로비 TV  ',
          location: 'A동 1층',
          groupIds: [groupId],
        })
        .expect(201);
      createdDeviceIds.push(res.body.id);

      expect(res.body).toMatchObject({
        name: 'E2E 로비 TV',
        location: 'A동 1층',
        groupIds: [groupId],
        orientation: 'LANDSCAPE',
        resolution: null,
        lastSeenAt: null,
        appVersion: null,
        status: 'OFFLINE',
        layout: { type: 'FOUR_GRID', rotationSeconds: 10 },
        refreshAfterSeconds: 60,
      });
      expect(res.body.token).toMatch(/^fgd_[A-Za-z0-9_-]{43}$/);
      expect(res.body).not.toHaveProperty('tokenHash');

      const [row] = await db
        .select()
        .from(devices)
        .where(eq(devices.id, res.body.id));
      expect(row.tokenHash).not.toBe(res.body.token);
    });

    it('SUPER_ADMIN만 등록할 수 있다', async () => {
      for (const user of [reviewer, submitter]) {
        await request(server())
          .post('/signage/devices')
          .set('Authorization', user.authHeader)
          .send({ name: 'x' })
          .expect(403);
      }
    });

    it('없거나 숨긴 그룹, 범위를 벗어난 설정은 422', async () => {
      const res = await request(server())
        .post('/signage/devices')
        .set('Authorization', admin.authHeader)
        .send({ name: 'x', rotationSeconds: 3, refreshAfterSeconds: 600 })
        .expect(422);
      expect(res.body.fields).toEqual({
        rotationSeconds: '전환 간격은 5초 이상이어야 합니다.',
        refreshAfterSeconds: '갱신 주기는 300초 이하여야 합니다.',
      });

      const groups = await request(server())
        .post('/signage/devices')
        .set('Authorization', admin.authHeader)
        .send({ name: 'x', groupIds: [hiddenGroupId, 'grp_nope'] })
        .expect(422);
      expect(groups.body.fields.groupIds).toContain(hiddenGroupId);
    });
  });

  describe('조회', () => {
    it('검토자는 목록·상세를 보고, 토큰은 나오지 않는다', async () => {
      const { id } = await register();
      const list = await request(server())
        .get('/signage/devices')
        .set('Authorization', reviewer.authHeader)
        .expect(200);
      const found = list.body.find((d: { id: string }) => d.id === id);
      expect(found).toBeDefined();
      expect(found).not.toHaveProperty('token');
      expect(found).not.toHaveProperty('tokenHash');

      await request(server())
        .get(`/signage/devices/${id}`)
        .set('Authorization', reviewer.authHeader)
        .expect(200);
    });

    it('일반 사용자는 403, 없는 기기는 404', async () => {
      await request(server())
        .get('/signage/devices')
        .set('Authorization', submitter.authHeader)
        .expect(403);
      await request(server())
        .get(`/signage/devices/${randomUUID()}`)
        .set('Authorization', reviewer.authHeader)
        .expect(404);
    });

    it('최근 heartbeat가 있으면 ONLINE', async () => {
      const { id } = await register();
      await db
        .update(devices)
        .set({
          lastSeenAt: new Date(Date.now() - 60_000),
          appVersion: '0.4.2',
          resolutionWidth: 1920,
          resolutionHeight: 1080,
        })
        .where(eq(devices.id, id));

      const res = await request(server())
        .get(`/signage/devices/${id}`)
        .set('Authorization', reviewer.authHeader)
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'ONLINE',
        appVersion: '0.4.2',
        resolution: { width: 1920, height: 1080 },
      });
    });
  });

  describe('기기 토큰 인증', () => {
    it('맞는 토큰이면 기기 정보를 준다', async () => {
      const { id, token } = await register({ location: 'B동' });
      const res = await session(id, token).expect(200);
      expect(res.body).toMatchObject({
        deviceId: id,
        name: 'E2E 로비 TV',
        location: 'B동',
        orientation: 'LANDSCAPE',
        serverTime: expect.any(String),
      });
    });

    it('토큰이 없거나 틀리면 401', async () => {
      const { id, token } = await register();
      await session(id).expect(401);
      await session(id, 'garbage').expect(401);
      await session(id, `fgd_${'A'.repeat(43)}`).expect(401);
      // 기기 API에 사용자 JWT는 통하지 않는다
      await request(server())
        .get(`/signage/devices/${id}/session`)
        .set('Authorization', admin.authHeader)
        .expect(401);
      // 반대로 관리자 API에 기기 토큰도 통하지 않는다
      await request(server())
        .get('/signage/devices')
        .set('X-Device-Token', token)
        .expect(401);
    });

    it('다른 기기의 경로로는 쓸 수 없다 (403)', async () => {
      const a = await register();
      const b = await register();
      const res = await session(b.id, a.token).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('재발급하면 이전 토큰은 즉시 무효', async () => {
      const { id, token, tokenIssuedAt } = await register();
      const res = await request(server())
        .post(`/signage/devices/${id}/rotate-token`)
        .set('Authorization', admin.authHeader)
        .expect(200);

      expect(res.body.token).not.toBe(token);
      expect(res.body.tokenIssuedAt).not.toBe(tokenIssuedAt);
      await session(id, token).expect(401);
      await session(id, res.body.token).expect(200);
    });

    it('비활성 기기는 토큰이 있어도 401, 다시 켜면 통한다', async () => {
      const { id, token } = await register();
      const disabled = await patch(id, { isActive: false }).expect(200);
      expect(disabled.body.status).toBe('DISABLED');
      await session(id, token).expect(401);

      await patch(id, { isActive: true }).expect(200);
      await session(id, token).expect(200);
    });
  });

  describe('수정과 그룹 기기 수', () => {
    it('보낸 필드만 바꾸고, 그룹의 활성 기기 수에 반영된다', async () => {
      const countOf = async () => {
        const res = await request(server())
          .get('/signage/target-groups')
          .set('Authorization', submitter.authHeader)
          .expect(200);
        return res.body.find((g: { id: string }) => g.id === groupId)
          .deviceCount as number;
      };

      const before = await countOf();
      const { id } = await register();
      expect(await countOf()).toBe(before + 1);

      const res = await patch(id, {
        layout: 'SINGLE',
        rotationSeconds: 20,
        groupIds: [],
      }).expect(200);
      expect(res.body).toMatchObject({
        name: 'E2E 로비 TV',
        groupIds: [],
        layout: { type: 'SINGLE', rotationSeconds: 20 },
      });
      expect(await countOf()).toBe(before);
    });

    it('등록·수정·재발급이 감사 로그에 남는다', async () => {
      const { id } = await register();
      await patch(id, { name: '새 이름' }).expect(200);
      await request(server())
        .post(`/signage/devices/${id}/rotate-token`)
        .set('Authorization', admin.authHeader)
        .expect(200);

      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.targetId, id))
        .orderBy(asc(auditLogs.createdAt));
      expect(logs.map((log) => [log.action, log.targetType])).toEqual([
        ['DEVICE_REGISTERED', 'DEVICE'],
        ['DEVICE_UPDATED', 'DEVICE'],
        ['DEVICE_TOKEN_ROTATED', 'DEVICE'],
      ]);
      expect(logs[1].metadata).toEqual({ changedFields: ['name'] });
      // 감사 로그에도 토큰은 남기지 않는다
      expect(JSON.stringify(logs)).not.toMatch(/fgd_/);
    });
  });
});
