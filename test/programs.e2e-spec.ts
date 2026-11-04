import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { seoulDate } from '../src/common/time/seoul-time.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  auditLogs,
  devices,
  programs,
  targetGroups,
} from '../src/db/schema.js';
import { CHANGE_BATCH_MS } from '../src/realtime/device-control.service.js';
import { dayPillarOf } from '../src/programs/types/daily-pillar.program.js';
import {
  createTestGroup,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

type RegisteredDevice = { id: string; token: string };

describe('운영 컨텐츠 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let admin: TestUser;
  let reviewer: TestUser;
  let groupId: string;
  let tv: RegisteredDevice;
  const programIds: string[] = [];

  const server = () => app.getHttpServer();
  const asAdmin = <T extends request.Test>(req: T) =>
    req.set('Authorization', admin.authHeader);

  async function createProgram(body: object): Promise<Record<string, any>> {
    const res = await asAdmin(request(server()).post('/signage/programs'))
      .send(body)
      .expect(201);
    programIds.push(res.body.id);
    return res.body;
  }

  async function saveLineup(
    change: (lineup: Record<string, any>) => Record<string, any>,
    status = 200,
  ) {
    const lineup = await asAdmin(
      request(server()).get(`/signage/target-groups/${groupId}/lineup`),
    ).expect(200);
    return asAdmin(
      request(server()).put(`/signage/target-groups/${groupId}/lineup`),
    )
      .send(change(lineup.body))
      .expect(status);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);

    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    groupId = await createTestGroup(app);
    const res = await asAdmin(request(server()).post('/signage/devices'))
      .send({
        name: `E2E 운영 TV ${randomUUID().slice(0, 8)}`,
        groupIds: [groupId],
      })
      .expect(201);
    tv = { id: res.body.id, token: res.body.token };
  });

  afterAll(async () => {
    await db
      .delete(auditLogs)
      .where(inArray(auditLogs.targetId, [...programIds, tv.id, groupId]));
    await db.delete(devices).where(eq(devices.id, tv.id));
    // 편성 블록이 그룹과 같이 지워진 뒤에 운영 컨텐츠를 지운다
    await db.delete(targetGroups).where(eq(targetGroups.id, groupId));
    await db.delete(programs).where(inArray(programs.id, programIds));
    await admin.remove();
    await reviewer.remove();
    await app.close();
  });

  it('종류 목록은 레지스트리의 폼 스키마와 정보줄 칸을 준다', async () => {
    const res = await asAdmin(
      request(server()).get('/signage/program-types'),
    ).expect(200);
    expect(res.body.map((type: { type: string }) => type.type)).toEqual([
      'DDAY',
      'EXAM_CHEER',
      'DAILY_PILLAR',
      'CLICK_BATTLE',
    ]);
    expect(res.body[0]).toEqual({
      type: 'DDAY',
      name: 'D-day',
      defaultDurationSeconds: 5,
      dataSource: 'NONE',
      dataset: null,
      collector: null,
      infoBarItem: 'DDAY',
      paramsSchema: {
        type: 'object',
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 20, title: '이름' },
          date: { type: 'string', format: 'date', title: '날짜' },
        },
        required: ['label', 'date'],
        additionalProperties: false,
      },
    });
    expect(res.body[2]).toMatchObject({
      type: 'DAILY_PILLAR',
      dataSource: 'GENERATED',
      infoBarItem: null,
    });
  });

  it('SUPER_ADMIN만 쓴다', async () => {
    await request(server())
      .get('/signage/programs')
      .set('Authorization', reviewer.authHeader)
      .expect(403);
    await request(server())
      .get('/signage/program-types')
      .set('Authorization', reviewer.authHeader)
      .expect(403);
  });

  it('만들고, 읽고, 고친다. 감사 로그를 남긴다', async () => {
    const created = await createProgram({
      type: 'DDAY',
      name: ' 기말고사 D-day ',
      params: { label: '기말고사', date: '2099-12-15' },
    });
    expect(created).toMatchObject({
      id: expect.stringMatching(/^prg_[0-9a-f]{12}$/),
      type: 'DDAY',
      name: '기말고사 D-day',
      params: { label: '기말고사', date: '2099-12-15' },
      usedByGroupIds: [],
      usedByDeviceIds: [],
      dataStatus: { state: 'OK', detail: expect.stringMatching(/^D-\d+$/) },
    });

    const list = await asAdmin(
      request(server()).get('/signage/programs'),
    ).expect(200);
    expect(list.body.map((row: { id: string }) => row.id)).toContain(
      created.id,
    );

    const patched = await asAdmin(
      request(server()).patch(`/signage/programs/${created.id}`),
    )
      .send({ params: { label: '기말고사', date: '2000-01-01' } })
      .expect(200);
    expect(patched.body).toMatchObject({
      name: '기말고사 D-day',
      params: { label: '기말고사', date: '2000-01-01' },
      dataStatus: { state: 'STALE' },
    });

    const logs = await db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, 'PROGRAM'),
          eq(auditLogs.targetId, created.id),
        ),
      )
      .orderBy(asc(auditLogs.createdAt));
    expect(logs).toEqual([
      {
        action: 'PROGRAM_CREATED',
        metadata: { type: 'DDAY', name: '기말고사 D-day' },
      },
      { action: 'PROGRAM_UPDATED', metadata: { changedFields: ['params'] } },
    ]);
  });

  it('params와 종류가 틀리면 422, 없으면 404', async () => {
    const bad = await asAdmin(request(server()).post('/signage/programs'))
      .send({ type: 'CLICK_BATTLE', name: '배틀', params: { rounds: 0 } })
      .expect(422);
    expect(bad.body.fields).toEqual({
      'params.rounds': '판 수는 1 이상이어야 합니다.',
    });
    const unknown = await asAdmin(request(server()).post('/signage/programs'))
      .send({ type: 'WEATHER', name: '날씨', params: {} })
      .expect(422);
    expect(Object.keys(unknown.body.fields)).toEqual(['type']);

    const pillar = await createProgram({
      type: 'DAILY_PILLAR',
      name: '오늘의 일진',
      params: {},
    });
    const patch = await asAdmin(
      request(server()).patch(`/signage/programs/${pillar.id}`),
    )
      .send({ type: 'DDAY', params: { label: 'x' } })
      .expect(422);
    expect(patch.body.fields).toEqual({
      body: '알 수 없는 항목이 있습니다: type',
    });
    const wrongParams = await asAdmin(
      request(server()).patch(`/signage/programs/${pillar.id}`),
    )
      .send({ params: { label: 'x' } })
      .expect(422);
    expect(wrongParams.body.fields).toEqual({
      params: '알 수 없는 항목이 있습니다: label',
    });

    await asAdmin(
      request(server()).get('/signage/programs/prg_missing'),
    ).expect(404);
    await asAdmin(
      request(server()).delete('/signage/programs/prg_missing'),
    ).expect(404);
  });

  it('편성 블록·그룹 정보줄·기기 예외 정보줄이 가리키면 지우지 못한다', async () => {
    const block = await createProgram({
      type: 'CLICK_BATTLE',
      name: '점심 클릭 배틀',
      params: { rounds: 3 },
    });
    const dday = await createProgram({
      type: 'DDAY',
      name: '축제 D-day',
      params: { label: '축제', date: '2099-05-20' },
    });
    const deviceDday = await createProgram({
      type: 'DDAY',
      name: '기숙사 D-day',
      params: { label: '퇴사', date: '2099-06-20' },
    });

    await saveLineup((lineup) => ({
      version: lineup.version,
      settings: {
        ...lineup.settings,
        infoBar: [{ item: 'DDAY', programId: dday.id }],
      },
      blocks: [
        ...lineup.blocks,
        { source: 'PROGRAM', programId: block.id, durationSeconds: 60 },
      ],
    }));
    await asAdmin(request(server()).patch(`/signage/devices/${tv.id}`))
      .send({
        overrides: {
          settings: { infoBar: [{ item: 'DDAY', programId: deviceDday.id }] },
          blocks: {},
        },
      })
      .expect(200);

    for (const [program, usage] of [
      [block, { usedByGroupIds: [groupId], usedByDeviceIds: [] }],
      [dday, { usedByGroupIds: [groupId], usedByDeviceIds: [] }],
      [deviceDday, { usedByGroupIds: [], usedByDeviceIds: [tv.id] }],
    ] as const) {
      const res = await asAdmin(
        request(server()).delete(`/signage/programs/${program.id}`),
      ).expect(409);
      expect(res.body).toMatchObject({ code: 'IN_USE', details: usage });
      const detail = await asAdmin(
        request(server()).get(`/signage/programs/${program.id}`),
      ).expect(200);
      expect(detail.body).toMatchObject(usage);
    }

    // 정보줄 칸과 종류가 맞지 않으면 편성 저장이 422다
    const wrong = await saveLineup(
      (lineup) => ({
        version: lineup.version,
        settings: {
          ...lineup.settings,
          infoBar: [{ item: 'DDAY', programId: block.id }],
        },
        blocks: lineup.blocks,
      }),
      422,
    );
    expect(wrong.body.fields).toEqual({
      'settings.infoBar.0.programId':
        '이 운영 컨텐츠는 정보줄의 DDAY 칸에 쓸 수 없습니다.',
    });

    // 빼고 나면 지워진다
    await saveLineup((lineup) => ({
      version: lineup.version,
      settings: { ...lineup.settings, infoBar: [] },
      blocks: lineup.blocks.filter(
        (b: { programId?: string }) => b.programId !== block.id,
      ),
    }));
    await asAdmin(request(server()).patch(`/signage/devices/${tv.id}`))
      .send({ overrides: { settings: {}, blocks: {} } })
      .expect(200);
    for (const program of [block, dday, deviceDday]) {
      await asAdmin(
        request(server()).delete(`/signage/programs/${program.id}`),
      ).expect(204);
    }
    const [deleted] = await db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetId, block.id),
          eq(auditLogs.action, 'PROGRAM_DELETED'),
        ),
      );
    expect(deleted.metadata).toEqual({
      type: 'CLICK_BATTLE',
      name: '점심 클릭 배틀',
    });
  });

  it('편성 응답 v2의 programs에 종류가 만든 data를 싣는다', async () => {
    const pillar = await createProgram({
      type: 'DAILY_PILLAR',
      name: '일진',
      params: {},
    });
    const cheer = await createProgram({
      type: 'EXAM_CHEER',
      name: '수능 응원',
      params: { label: '수능', date: '2099-11-19' },
    });
    await saveLineup((lineup) => ({
      version: lineup.version,
      settings: lineup.settings,
      blocks: [
        ...lineup.blocks,
        { source: 'PROGRAM', programId: pillar.id, durationSeconds: 8 },
        { source: 'PROGRAM', programId: cheer.id, durationSeconds: 8 },
      ],
    }));

    const res = await request(server())
      .get(`/signage/devices/${tv.id}/playlist?v=2`)
      .set('X-Device-Token', tv.token)
      .expect(200);
    expect(res.body.programs[pillar.id]).toEqual({
      type: 'DAILY_PILLAR',
      name: '일진',
      params: {},
      data: dayPillarOf(seoulDate(new Date())),
    });
    expect(res.body.programs[cheer.id]).toEqual({
      type: 'EXAM_CHEER',
      name: '수능 응원',
      params: { label: '수능', date: '2099-11-19', message: null },
      data: null,
    });
  });

  it('고치면 쓰는 그룹의 TV에 program-changed를 보낸다', async () => {
    const program = await createProgram({
      type: 'CLICK_BATTLE',
      name: '저녁 배틀',
      params: { rounds: 2 },
    });
    await saveLineup((lineup) => ({
      version: lineup.version,
      settings: lineup.settings,
      blocks: [
        ...lineup.blocks,
        { source: 'PROGRAM', programId: program.id, durationSeconds: 60 },
      ],
    }));

    const { port } = server().address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/devices/ws`, {
      origin: 'http://localhost:5173',
    });
    const frames: { type: string }[] = [];
    socket.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ type: 'auth', token: tv.token }));
    const waitFor = async (type: string) => {
      const deadline = Date.now() + CHANGE_BATCH_MS + 1_500;
      while (!frames.some((frame) => frame.type === type)) {
        if (Date.now() > deadline) throw new Error(`no ${type}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    await waitFor('ready');
    // 편성 저장 알림이 지나간 뒤에 본다
    await new Promise((resolve) => setTimeout(resolve, CHANGE_BATCH_MS + 200));
    frames.length = 0;

    await asAdmin(request(server()).patch(`/signage/programs/${program.id}`))
      .send({ name: '저녁 클릭 배틀' })
      .expect(200);
    await waitFor('program-changed');
    socket.close();
  });

  it('삭제와 정보줄 저장이 겹쳐도 둘 중 하나만 이긴다', async () => {
    for (let round = 0; round < 5; round++) {
      const program = await createProgram({
        type: 'DDAY',
        name: `동시 D-day ${round}`,
        params: { label: '동시', date: '2099-01-01' },
      });
      const lineup = await asAdmin(
        request(server()).get(`/signage/target-groups/${groupId}/lineup`),
      ).expect(200);
      const [saved, deleted] = await Promise.all([
        asAdmin(
          request(server()).put(`/signage/target-groups/${groupId}/lineup`),
        ).send({
          version: lineup.body.version,
          settings: {
            ...lineup.body.settings,
            infoBar: [{ item: 'DDAY', programId: program.id }],
          },
          blocks: lineup.body.blocks,
        }),
        asAdmin(request(server()).delete(`/signage/programs/${program.id}`)),
      ]);
      // 저장이 먼저면 삭제가 409, 삭제가 먼저면 저장이 422다
      expect([
        [200, 409],
        [422, 204],
      ]).toContainEqual([saved.status, deleted.status]);
      if (saved.status === 200) {
        await saveLineup((current) => ({
          version: current.version,
          settings: { ...current.settings, infoBar: [] },
          blocks: current.blocks,
        }));
      }
    }
  });
});
