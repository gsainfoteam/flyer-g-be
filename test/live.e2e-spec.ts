import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  auditLogs,
  devices,
  liveStates,
  programs,
  submissionTargetGroups,
  submissions,
  targetGroups,
} from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import { MemoryStorage } from './helpers/memory-storage.js';
import {
  createReadyAsset,
  createTestGroup,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

const HOUR = 3600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

type RegisteredDevice = { id: string; token: string };

describe('라이브 상태 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let admin: TestUser;
  let reviewer: TestUser;
  let requester: TestUser;
  let groupId: string;
  let otherGroupId: string;
  let tv: RegisteredDevice;
  let otherTv: RegisteredDevice;
  let assetId: string;
  const submissionIds: string[] = [];
  const programId = `prg_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new MemoryStorage())
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);

    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    requester = await createTestUser(app);
    assetId = await createReadyAsset(app, requester.user.id);
    groupId = await createTestGroup(app);
    otherGroupId = await createTestGroup(app);
    const now = new Date();
    await db.insert(programs).values({
      id: programId,
      type: 'DDAY',
      name: 'E2E 라이브 D-day',
      params: {},
      createdAt: now,
      updatedAt: now,
    });
    tv = await register([groupId]);
    otherTv = await register([otherGroupId]);
  });

  afterAll(async () => {
    const deviceIds = [tv.id, otherTv.id];
    await db
      .delete(liveStates)
      .where(
        inArray(liveStates.scopeId, [...deviceIds, groupId, otherGroupId]),
      );
    await db
      .delete(auditLogs)
      .where(
        inArray(auditLogs.targetId, [...deviceIds, groupId, otherGroupId]),
      );
    await db.delete(submissions).where(inArray(submissions.id, submissionIds));
    await db.delete(devices).where(inArray(devices.id, deviceIds));
    await db
      .delete(targetGroups)
      .where(inArray(targetGroups.id, [groupId, otherGroupId]));
    await db.delete(programs).where(eq(programs.id, programId));
    for (const user of [admin, reviewer, requester]) {
      await user.remove();
    }
    await app.close();
  });

  const server = () => app.getHttpServer();

  async function register(groupIds: string[]): Promise<RegisteredDevice> {
    const res = await request(server())
      .post('/signage/devices')
      .set('Authorization', admin.authHeader)
      .send({ name: 'E2E 라이브 TV', groupIds })
      .expect(201);
    return { id: res.body.id, token: res.body.token };
  }

  const putLive = (path: string, body: object, user = admin) =>
    request(server())
      .put(`/signage/${path}/live`)
      .set('Authorization', user.authHeader)
      .send(body);

  const deleteLive = (path: string) =>
    request(server())
      .delete(`/signage/${path}/live`)
      .set('Authorization', admin.authHeader);

  const deviceLive = async (device: RegisteredDevice) =>
    (
      await request(server())
        .get(`/signage/devices/${device.id}`)
        .set('Authorization', admin.authHeader)
        .expect(200)
    ).body.live;

  const playlistV2 = async (device: RegisteredDevice) =>
    (
      await request(server())
        .get(`/signage/devices/${device.id}/playlist?v=2`)
        .set('X-Device-Token', device.token)
        .expect(200)
    ).body;

  /** 다른 그룹(otherGroupId)만 대상으로 하는 포스터 */
  async function insertPoster(status: 'PUBLISHED' | 'PENDING_REVIEW') {
    const now = new Date();
    const [row] = await db
      .insert(submissions)
      .values({
        requesterId: requester.user.id,
        title: `E2E 라이브 ${status}`,
        categoryId: 'performance',
        assetId,
        startAt: new Date(Date.now() - HOUR),
        endAt: new Date(Date.now() + HOUR),
        status,
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: submissions.id });
    submissionIds.push(row.id);
    await db
      .insert(submissionTargetGroups)
      .values({ submissionId: row.id, targetGroupId: otherGroupId });
    return row.id;
  }

  it('SHOW는 대상이 아닌 기기에도 그 신청을 싣는다', async () => {
    const posterId = await insertPoster('PUBLISHED');
    const res = await putLive(`devices/${tv.id}`, {
      main: { action: 'SHOW', submissionId: posterId, until: at(HOUR) },
    }).expect(200);
    expect(res.body).toEqual({
      main: {
        action: 'SHOW',
        submissionId: posterId,
        programId: null,
        until: expect.any(String),
      },
      alert: null,
      setBy: { id: admin.user.id, name: admin.user.name },
      setAt: expect.any(String),
    });

    const playlist = await playlistV2(tv);
    expect(playlist.live).toEqual({
      main: res.body.main,
      alert: null,
      setAt: res.body.setAt,
    });
    expect(
      playlist.submissions.POSTER.map(
        (p: { submissionId: string }) => p.submissionId,
      ),
    ).toContain(posterId);
    expect(await deviceLive(tv)).toEqual(res.body);

    // 게시 중이 아닌 신청을 가리키면 main이 내려간다
    const pendingId = await insertPoster('PENDING_REVIEW');
    await putLive(`devices/${tv.id}`, {
      main: { action: 'SHOW', submissionId: pendingId },
    }).expect(200);
    expect((await playlistV2(tv)).live).toBeNull();
  });

  it('SHOW 운영 컨텐츠는 programs에 싣는다', async () => {
    await putLive(`devices/${tv.id}`, {
      main: { action: 'SHOW', programId },
    }).expect(200);
    const playlist = await playlistV2(tv);
    expect(playlist.live.main).toEqual({
      action: 'SHOW',
      submissionId: null,
      programId,
      until: null,
    });
    expect(playlist.programs[programId]).toMatchObject({ type: 'DDAY' });
  });

  it('그룹 라이브는 그룹 기기에 나가고, main·alert를 기기 값과 따로 고른다', async () => {
    await putLive(`target-groups/${groupId}`, {
      main: {
        action: 'GAME',
        game: { type: 'CLICK_BATTLE', rounds: 3 },
        until: at(HOUR),
      },
      alert: { text: '  B동 단수 예정  ', until: at(2 * HOUR) },
    }).expect(200);

    // 기기에는 SHOW(main)만 있다 → main은 기기 값, alert는 그룹 값
    const live = await deviceLive(tv);
    expect(live.main).toMatchObject({ action: 'SHOW', programId });
    expect(live.alert).toEqual({
      text: 'B동 단수 예정',
      until: expect.any(String),
    });
    expect(await deviceLive(otherTv)).toBeNull();

    // 기기 라이브를 해제하면 그룹 게임이 나온다
    await deleteLive(`devices/${tv.id}`).expect(204);
    expect((await deviceLive(tv)).main).toMatchObject({ action: 'GAME' });
    expect((await playlistV2(tv)).live.main).toMatchObject({
      game: { type: 'CLICK_BATTLE', rounds: 3 },
    });

    const group = await request(server())
      .get(`/signage/target-groups/${groupId}/live`)
      .set('Authorization', admin.authHeader)
      .expect(200);
    expect(group.body.main).toMatchObject({ action: 'GAME' });
  });

  it('until이 지난 부분은 읽을 때 뺀다', async () => {
    await db
      .update(liveStates)
      .set({
        main: sql`jsonb_set(${liveStates.main}, '{until}', ${JSON.stringify(at(-1000))}::jsonb)`,
      })
      .where(
        and(eq(liveStates.scope, 'GROUP'), eq(liveStates.scopeId, groupId)),
      );

    const live = await deviceLive(tv);
    expect(live.main).toBeNull();
    expect(live.alert).toMatchObject({ text: 'B동 단수 예정' });
    expect((await playlistV2(tv)).live.main).toBeNull();
  });

  it('입력 검증: 시각, 게임 시간, 없는 대상', async () => {
    const res = await putLive(`devices/${tv.id}`, {
      main: {
        action: 'GAME',
        game: { type: 'CLICK_BATTLE', rounds: 3 },
        until: at(4 * HOUR),
      },
      alert: { text: '알림', until: at(-HOUR) },
    }).expect(422);
    expect(res.body.fields).toEqual({
      'main.until': '게임 끝 시각은 지금부터 3시간 안이어야 합니다.',
      'alert.until': '끝 시각은 지금보다 뒤여야 합니다.',
    });

    const missing = await putLive(`devices/${tv.id}`, {
      main: { action: 'SHOW', submissionId: randomUUID() },
    }).expect(422);
    expect(missing.body.fields).toEqual({
      'main.submissionId': '없는 신청입니다.',
    });
    const noProgram = await putLive(`devices/${tv.id}`, {
      main: { action: 'SHOW', programId: 'prg_nope' },
    }).expect(422);
    expect(noProgram.body.fields).toEqual({
      'main.programId': '없는 운영 컨텐츠입니다.',
    });

    const shape = await putLive(`devices/${tv.id}`, {
      main: { action: 'DANCE' },
      extra: 1,
    }).expect(422);
    expect(shape.body.fields).toEqual({
      body: '알 수 없는 항목이 있습니다: extra',
      'main.action': '라이브 종류가 올바르지 않습니다.',
    });
  });

  it('SUPER_ADMIN만, 없는 기기·그룹은 404', async () => {
    await putLive(`devices/${tv.id}`, {}, reviewer).expect(403);
    await putLive(`devices/${randomUUID()}`, {
      alert: { text: '알림' },
    }).expect(404);
    await putLive('devices/not-a-uuid', { alert: { text: '알림' } }).expect(
      404,
    );
    await putLive('target-groups/grp_nope_live', {
      alert: { text: '알림' },
    }).expect(404);
    await deleteLive('target-groups/grp_nope_live').expect(404);
  });

  it('둘 다 null이면 해제와 같고, 감사 로그는 설정·해제 때만 남는다', async () => {
    const device = otherTv;
    await putLive(`devices/${device.id}`, { alert: { text: '알림' } }).expect(
      200,
    );
    const cleared = await putLive(`devices/${device.id}`, {
      main: null,
      alert: null,
    }).expect(200);
    expect(cleared.body).toEqual({
      main: null,
      alert: null,
      setBy: null,
      setAt: null,
    });
    await deleteLive(`devices/${device.id}`).expect(204);

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, device.id))
      .orderBy(asc(auditLogs.createdAt));
    expect(
      logs
        .filter((log) => log.action.startsWith('LIVE_'))
        .map((log) => [log.action, log.targetType]),
    ).toEqual([
      ['LIVE_SET', 'DEVICE'],
      ['LIVE_CLEARED', 'DEVICE'],
    ]);
  });

  it('그룹을 지우면 그룹 라이브도 지워진다', async () => {
    const res = await request(server())
      .post('/signage/target-groups')
      .set('Authorization', admin.authHeader)
      .send({ name: `E2E 라이브 삭제 ${randomUUID().slice(0, 8)}` })
      .expect(201);
    const id = res.body.id as string;
    await putLive(`target-groups/${id}`, { alert: { text: '알림' } }).expect(
      200,
    );
    await request(server())
      .delete(`/signage/target-groups/${id}`)
      .set('Authorization', admin.authHeader)
      .expect(204);
    const rows = await db
      .select()
      .from(liveStates)
      .where(eq(liveStates.scopeId, id));
    expect(rows).toEqual([]);
    await db.delete(auditLogs).where(eq(auditLogs.targetId, id));
  });
});
