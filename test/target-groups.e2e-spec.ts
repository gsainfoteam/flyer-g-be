import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { asc, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  auditLogs,
  devices,
  submissions,
  submissionTargetGroups,
  targetGroups,
} from '../src/db/schema.js';
import {
  createReadyAsset,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

type Group = {
  id: string;
  name: string;
  deviceCount: number;
  isHidden: boolean;
};

describe('대상 위치 그룹 관리 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let admin: TestUser;
  let reviewer: TestUser;
  let submitter: TestUser;
  const createdGroupIds: string[] = [];
  const createdDeviceIds: string[] = [];
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
    // 사용자를 지우면 그 사용자의 신청과 감사 로그도 지워진다.
    for (const user of [admin, reviewer, submitter]) {
      await user.remove();
    }
    if (createdGroupIds.length > 0) {
      await db
        .delete(targetGroups)
        .where(inArray(targetGroups.id, createdGroupIds));
    }
    await app.close();
  });

  const server = () => app.getHttpServer();

  const list = async () => {
    const res = await request(server())
      .get('/signage/target-groups')
      .set('Authorization', submitter.authHeader)
      .expect(200);
    return res.body as Group[];
  };

  const post = (body: object, user = admin) =>
    request(server())
      .post('/signage/target-groups')
      .set('Authorization', user.authHeader)
      .send(body);

  const patch = (id: string, body: object, user = admin) =>
    request(server())
      .patch(`/signage/target-groups/${id}`)
      .set('Authorization', user.authHeader)
      .send(body);

  const remove = (id: string, user = admin) =>
    request(server())
      .delete(`/signage/target-groups/${id}`)
      .set('Authorization', user.authHeader);

  async function createGroup(name: string): Promise<Group> {
    const res = await post({ name }).expect(201);
    createdGroupIds.push(res.body.id);
    return res.body as Group;
  }

  const logsOf = (id: string) =>
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, id))
      .orderBy(asc(auditLogs.createdAt));

  describe('권한', () => {
    it('변경은 로그인이 필요하다', async () => {
      await request(server())
        .post('/signage/target-groups')
        .send({ name: 'x' })
        .expect(401);
      await request(server())
        .patch('/signage/target-groups/grp_x')
        .send({ name: 'x' })
        .expect(401);
      await request(server())
        .delete('/signage/target-groups/grp_x')
        .expect(401);
    });

    it('SUPER_ADMIN만 바꿀 수 있다', async () => {
      const group = await createGroup(`E2E 권한 ${tag}`);
      for (const user of [reviewer, submitter]) {
        expect((await post({ name: `E2E 남 ${tag}` }, user)).status).toBe(403);
        expect((await patch(group.id, { name: 'x' }, user)).status).toBe(403);
        expect((await remove(group.id, user)).status).toBe(403);
      }
    });
  });

  describe('추가', () => {
    it('ID는 서버가 만들고, 이름 앞뒤 공백을 지운다', async () => {
      const res = await post({ name: `  E2E 로비 ${tag}  ` }).expect(201);
      createdGroupIds.push(res.body.id);

      expect(res.body).toEqual({
        id: expect.stringMatching(/^grp_[0-9a-f]{16}$/),
        name: `E2E 로비 ${tag}`,
        deviceCount: 0,
        isHidden: false,
      });
      expect(await list()).toContainEqual(res.body);

      const logs = await logsOf(res.body.id);
      expect(logs).toMatchObject([
        {
          actorType: 'USER',
          actorId: admin.user.id,
          action: 'GROUP_CREATED',
          targetType: 'GROUP',
          metadata: { name: `E2E 로비 ${tag}` },
        },
      ]);
    });

    it('이름은 공백을 지운 뒤 1~40자', async () => {
      for (const name of ['   ', '', 'x'.repeat(41), 123, null]) {
        const res = await post({ name }).expect(422);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(Object.keys(res.body.fields)).toEqual(['name']);
      }
      await post({}).expect(422);

      const longest = `${tag}${'가'.repeat(32)}`;
      expect(longest).toHaveLength(40);
      await createGroup(longest);
    });

    it('대소문자를 무시하고, 숨긴 그룹과도 이름이 겹치면 422', async () => {
      const group = await createGroup(`E2E Lobby ${tag}`);

      const res = await post({ name: `e2e LOBBY ${tag}` }).expect(422);
      expect(res.body.fields).toEqual({
        name: '같은 이름의 그룹이 이미 있습니다.',
      });

      await patch(group.id, { isHidden: true }).expect(200);
      await post({ name: `E2E LOBBY ${tag}` }).expect(422);
    });
  });

  describe('수정', () => {
    it('이름을 바꾸고 이전·이후 값을 감사 로그에 남긴다', async () => {
      const group = await createGroup(`E2E 수정 전 ${tag}`);

      const res = await patch(group.id, {
        name: ` E2E 수정 후 ${tag} `,
      }).expect(200);
      expect(res.body).toEqual({ ...group, name: `E2E 수정 후 ${tag}` });

      const logs = await logsOf(group.id);
      expect(logs[1]).toMatchObject({
        action: 'GROUP_UPDATED',
        targetType: 'GROUP',
        metadata: {
          changes: {
            name: { from: `E2E 수정 전 ${tag}`, to: `E2E 수정 후 ${tag}` },
          },
        },
      });
    });

    it('대소문자만 바꾸는 것은 된다. 다른 그룹과 겹치면 422', async () => {
      const group = await createGroup(`E2E case ${tag}`);
      const other = await createGroup(`E2E other ${tag}`);

      await patch(group.id, { name: `E2E CASE ${tag}` }).expect(200);
      const res = await patch(other.id, { name: `e2e case ${tag}` }).expect(
        422,
      );
      expect(res.body.fields).toEqual({
        name: '같은 이름의 그룹이 이미 있습니다.',
      });
    });

    it('숨겨도 목록에 isHidden으로 남고, 다시 보이게 할 수 있다', async () => {
      const group = await createGroup(`E2E 숨김 ${tag}`);

      const hidden = await patch(group.id, { isHidden: true }).expect(200);
      expect(hidden.body.isHidden).toBe(true);
      expect(await list()).toContainEqual({ ...group, isHidden: true });

      const shown = await patch(group.id, { isHidden: false }).expect(200);
      expect(shown.body.isHidden).toBe(false);

      const logs = await logsOf(group.id);
      expect(logs.slice(1).map((log) => log.metadata)).toEqual([
        { changes: { isHidden: { from: false, to: true } } },
        { changes: { isHidden: { from: true, to: false } } },
      ]);
    });

    it('바뀐 게 없으면 감사 로그를 남기지 않는다', async () => {
      const group = await createGroup(`E2E 그대로 ${tag}`);

      const res = await patch(group.id, {
        name: group.name,
        isHidden: false,
      }).expect(200);
      expect(res.body).toEqual(group);
      await patch(group.id, {}).expect(200);

      expect(await logsOf(group.id)).toHaveLength(1);
    });

    it('숨김 여부가 불리언이 아니면 422, 없는 그룹이면 404', async () => {
      const group = await createGroup(`E2E 검증 ${tag}`);
      const res = await patch(group.id, { isHidden: 'yes' }).expect(422);
      expect(Object.keys(res.body.fields)).toEqual(['isHidden']);

      const missing = await patch('grp_nope', { name: 'x' }).expect(404);
      expect(missing.body.code).toBe('NOT_FOUND');
    });
  });

  describe('삭제', () => {
    it('쓰는 곳이 없으면 지우고 감사 로그에 이름을 남긴다', async () => {
      const group = await createGroup(`E2E 오타 ${tag}`);

      await remove(group.id).expect(204);
      expect((await list()).map((g) => g.id)).not.toContain(group.id);
      expect((await remove(group.id).expect(404)).body.code).toBe('NOT_FOUND');

      const logs = await logsOf(group.id);
      expect(logs.map((log) => [log.action, log.metadata])).toEqual([
        ['GROUP_CREATED', { name: `E2E 오타 ${tag}` }],
        ['GROUP_DELETED', { name: `E2E 오타 ${tag}` }],
      ]);
    });

    it('기기가 쓰는 그룹은 숨겨도 지울 수 없다 (409)', async () => {
      const group = await createGroup(`E2E 기기용 ${tag}`);
      const device = await request(server())
        .post('/signage/devices')
        .set('Authorization', admin.authHeader)
        .send({ name: 'E2E 그룹 TV', groupIds: [group.id] })
        .expect(201);
      createdDeviceIds.push(device.body.id);
      // 비활성 기기도 쓰는 곳으로 센다
      await db
        .update(devices)
        .set({ isActive: false })
        .where(eq(devices.id, device.body.id));
      await patch(group.id, { isHidden: true }).expect(200);

      const res = await remove(group.id).expect(409);
      expect(res.body.code).toBe('CONFLICT');
      expect((await list()).map((g) => g.id)).toContain(group.id);
      expect((await logsOf(group.id)).map((log) => log.action)).not.toContain(
        'GROUP_DELETED',
      );
    });

    it('신청이 쓰는 그룹은 지울 수 없다 (409)', async () => {
      const group = await createGroup(`E2E 신청용 ${tag}`);
      const now = new Date();
      const [submission] = await db
        .insert(submissions)
        .values({
          requesterId: submitter.user.id,
          title: 'E2E 그룹 삭제 확인',
          categoryId: 'notice',
          assetId: await createReadyAsset(app, submitter.user.id),
          startAt: new Date(now.getTime() + 86_400_000),
          endAt: new Date(now.getTime() + 2 * 86_400_000),
          // 끝난 신청도 쓰는 곳으로 센다
          status: 'CANCELED',
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: submissions.id });
      await db
        .insert(submissionTargetGroups)
        .values({ submissionId: submission.id, targetGroupId: group.id });

      const res = await remove(group.id).expect(409);
      expect(res.body.code).toBe('CONFLICT');
    });
  });

  describe('감사 로그 조회', () => {
    it('GROUP으로 거르고 현재 그룹 이름을 targetTitle로 준다', async () => {
      const group = await createGroup(`E2E 로그 ${tag}`);
      await patch(group.id, { name: `E2E 로그 새 이름 ${tag}` }).expect(200);

      const res = await request(server())
        .get('/signage/audit-logs')
        .query({ targetType: 'GROUP', targetId: group.id })
        .set('Authorization', reviewer.authHeader)
        .expect(200);
      expect(
        res.body.items.map((log: { action: string; targetTitle: string }) => [
          log.action,
          log.targetTitle,
        ]),
      ).toEqual([
        ['GROUP_UPDATED', `E2E 로그 새 이름 ${tag}`],
        ['GROUP_CREATED', `E2E 로그 새 이름 ${tag}`],
      ]);
    });
  });
});
