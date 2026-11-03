import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  auditLogs,
  devices,
  liveStates,
  submissions,
  targetGroups,
} from '../src/db/schema.js';
import { SubmissionStatusJob } from '../src/jobs/submission-status.job.js';
import { CHANGE_BATCH_MS } from '../src/realtime/device-control.service.js';
import {
  createTestGroup,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

const ORIGIN = 'http://localhost:5173';
/** 모으는 시간보다 넉넉히 기다린다 */
const DELIVERY_MS = CHANGE_BATCH_MS + 1_500;

type Frame = Record<string, unknown>;
type RegisteredDevice = { id: string; token: string };

/** 소켓이 받은 프레임을 모두 쌓는다. 순서와 놓침 걱정 없이 나중에 찾는다 */
interface Tv {
  socket: WebSocket;
  frames: Frame[];
  closed: Promise<number>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  frames: Frame[],
  type: string,
  timeoutMs = DELIVERY_MS,
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = frames.find((frame) => frame.type === type);
    if (found) return found;
    if (Date.now() > deadline) {
      throw new Error(`No ${type} frame in ${JSON.stringify(frames)}`);
    }
    await sleep(20);
  }
}

describe('TV 제어 채널 /devices/ws (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let base: string;
  let admin: TestUser;
  let requester: TestUser;
  const submissionIds: string[] = [];
  let groupId: string;
  let otherGroupId: string;
  let tv: RegisteredDevice;
  let otherTv: RegisteredDevice;
  const sockets: WebSocket[] = [];

  const server = () => app.getHttpServer();

  function open(origin = ORIGIN): Tv {
    const socket = new WebSocket(`${base}/devices/ws`, { origin });
    sockets.push(socket);
    const frames: Frame[] = [];
    socket.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    const closed = new Promise<number>((resolve) =>
      socket.once('close', (code) => resolve(code)),
    );
    return { socket, frames, closed };
  }

  async function connect(token: string): Promise<Tv> {
    const conn = open();
    await new Promise<void>((resolve, reject) => {
      conn.socket.once('open', () => resolve());
      conn.socket.once('error', reject);
    });
    conn.socket.send(JSON.stringify({ type: 'auth', token }));
    await waitFor(conn.frames, 'ready', 2_000);
    return conn;
  }

  async function register(groupIds: string[]): Promise<RegisteredDevice> {
    const res = await request(server())
      .post('/signage/devices')
      .set('Authorization', admin.authHeader)
      .send({ name: `E2E 제어 TV ${randomUUID().slice(0, 8)}`, groupIds })
      .expect(201);
    return { id: res.body.id, token: res.body.token };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = server().address() as AddressInfo;
    base = `ws://127.0.0.1:${port}`;
    db = app.get<Database>(DB_CONNECTION);

    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
    requester = await createTestUser(app);
    groupId = await createTestGroup(app);
    otherGroupId = await createTestGroup(app);
    tv = await register([groupId]);
    otherTv = await register([otherGroupId]);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.terminate();
    const ids = [tv.id, otherTv.id, groupId, otherGroupId];
    await db.delete(liveStates).where(inArray(liveStates.scopeId, ids));
    await db
      .delete(auditLogs)
      .where(inArray(auditLogs.targetId, [...ids, ...submissionIds]));
    await db.delete(submissions).where(inArray(submissions.id, submissionIds));
    await db.delete(devices).where(inArray(devices.id, [tv.id, otherTv.id]));
    await db
      .delete(targetGroups)
      .where(inArray(targetGroups.id, [groupId, otherGroupId]));
    await admin.remove();
    await requester.remove();
    await app.close();
  });

  it('기기 토큰으로 인증하면 ready를 받고, 기기 응답의 controlConnected가 true다', async () => {
    const before = await request(server())
      .get(`/signage/devices/${tv.id}`)
      .set('Authorization', admin.authHeader)
      .expect(200);
    expect(before.body.controlConnected).toBe(false);

    const conn = await connect(tv.token);
    const after = await request(server())
      .get(`/signage/devices/${tv.id}`)
      .set('Authorization', admin.authHeader)
      .expect(200);
    expect(after.body.controlConnected).toBe(true);

    const closed = conn.closed;
    conn.socket.close();
    await closed;
    await sleep(50);
    const gone = await request(server())
      .get(`/signage/devices/${tv.id}`)
      .set('Authorization', admin.authHeader)
      .expect(200);
    expect(gone.body.controlConnected).toBe(false);
  });

  it('틀린 토큰과 허용하지 않은 Origin은 받지 않는다', async () => {
    const bad = open();
    bad.socket.once('open', () =>
      bad.socket.send(JSON.stringify({ type: 'auth', token: 'fgd_nope' })),
    );
    expect(await bad.closed).toBe(4001);

    const notAuth = open();
    notAuth.socket.once('open', () =>
      notAuth.socket.send(JSON.stringify({ type: 'send', data: 1 })),
    );
    expect(await notAuth.closed).toBe(4001);

    const evil = open('https://evil.example');
    const rejected = new Promise<string>((resolve) =>
      evil.socket.once('error', (error) => resolve(error.message)),
    );
    expect(await rejected).toMatch(/403/);
  });

  it('같은 기기가 새로 연결하면 이전 연결은 4010으로 닫힌다', async () => {
    const first = await connect(tv.token);
    const second = await connect(tv.token);
    expect(await first.closed).toBe(4010);
    second.socket.close();
    await second.closed;
  });

  it('기기 라이브를 바꾸면 그 기기에만 program-changed가 간다', async () => {
    const mine = await connect(tv.token);
    const other = await connect(otherTv.token);

    await request(server())
      .put(`/signage/devices/${tv.id}/live`)
      .set('Authorization', admin.authHeader)
      .send({ alert: { text: '점검 안내' } })
      .expect(200);
    expect(await waitFor(mine.frames, 'program-changed')).toEqual({
      type: 'program-changed',
    });
    expect(
      other.frames.filter((frame) => frame.type === 'program-changed'),
    ).toEqual([]);

    mine.socket.close();
    other.socket.close();
    await Promise.all([mine.closed, other.closed]);
  });

  it('그룹 편성·그룹 라이브를 바꾸면 그 그룹 기기에 한 번 모아 보낸다', async () => {
    const mine = await connect(tv.token);
    const other = await connect(otherTv.token);

    const lineup = await request(server())
      .get(`/signage/target-groups/${groupId}/lineup`)
      .set('Authorization', admin.authHeader)
      .expect(200);
    await request(server())
      .put(`/signage/target-groups/${groupId}/lineup`)
      .set('Authorization', admin.authHeader)
      .send({
        version: lineup.body.version,
        settings: { ...lineup.body.settings, rotationSeconds: 15 },
        blocks: lineup.body.blocks,
      })
      .expect(200);
    await request(server())
      .put(`/signage/target-groups/${groupId}/live`)
      .set('Authorization', admin.authHeader)
      .send({ alert: { text: '그룹 안내' } })
      .expect(200);

    await waitFor(mine.frames, 'program-changed');
    // 모으는 시간이 한 번 더 지나도 두 번째는 오지 않는다
    await sleep(CHANGE_BATCH_MS + 200);
    expect(
      mine.frames.filter((frame) => frame.type === 'program-changed'),
    ).toHaveLength(1);
    expect(
      other.frames.filter((frame) => frame.type === 'program-changed'),
    ).toEqual([]);

    mine.socket.close();
    other.socket.close();
    await Promise.all([mine.closed, other.closed]);
  });

  it('상태 배치가 게시를 시작하면 연결된 모든 TV에 알린다', async () => {
    const mine = await connect(tv.token);
    const other = await connect(otherTv.token);
    const now = new Date();
    const [row] = await db
      .insert(submissions)
      .values({
        requesterId: requester.user.id,
        type: 'STORY',
        title: 'E2E 제어 예약',
        startAt: new Date(now.getTime() - 60_000),
        endAt: new Date(now.getTime() + 3600_000),
        status: 'SCHEDULED',
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: submissions.id });
    submissionIds.push(row.id);

    const result = await app.get(SubmissionStatusJob).run();
    expect(result?.published).toBeGreaterThanOrEqual(1);
    await waitFor(mine.frames, 'program-changed');
    await waitFor(other.frames, 'program-changed');

    mine.socket.close();
    other.socket.close();
    await Promise.all([mine.closed, other.closed]);
  });

  it('새로고침은 연결된 TV에만 간다', async () => {
    const off = await request(server())
      .post(`/signage/devices/${tv.id}/reload`)
      .set('Authorization', admin.authHeader)
      .expect(200);
    expect(off.body).toEqual({ delivered: false });

    const conn = await connect(tv.token);
    const on = await request(server())
      .post(`/signage/devices/${tv.id}/reload`)
      .set('Authorization', admin.authHeader)
      .expect(200);
    expect(on.body).toEqual({ delivered: true });
    expect(await waitFor(conn.frames, 'reload', 1_000)).toEqual({
      type: 'reload',
    });

    await request(server())
      .post(`/signage/devices/${randomUUID()}/reload`)
      .set('Authorization', admin.authHeader)
      .expect(404);
    conn.socket.close();
    await conn.closed;
  });

  it('같은 연결로 폰 참가자를 받는다', async () => {
    const conn = await connect(tv.token);
    const phone = new WebSocket(`${base}/games/ws?room=${tv.id}&role=player`, {
      origin: ORIGIN,
    });
    sockets.push(phone);
    const hello = new Promise<Frame>((resolve) =>
      phone.once('message', (raw) => resolve(JSON.parse(raw.toString()))),
    );
    expect(await hello).toEqual({ type: 'host', online: true });
    await waitFor(conn.frames, 'join', 1_000);

    const toPhone = new Promise<Frame>((resolve) =>
      phone.once('message', (raw) => resolve(JSON.parse(raw.toString()))),
    );
    conn.socket.send(JSON.stringify({ type: 'send', data: { kind: 'state' } }));
    expect(await toPhone).toEqual({ type: 'message', data: { kind: 'state' } });

    phone.close();
    conn.socket.close();
    await conn.closed;
  });

  it('토큰을 재발급하면 이전 연결을 4001로 닫는다', async () => {
    const conn = await connect(otherTv.token);
    const res = await request(server())
      .post(`/signage/devices/${otherTv.id}/rotate-token`)
      .set('Authorization', admin.authHeader)
      .expect(200);
    expect(await conn.closed).toBe(4001);
    otherTv = { ...otherTv, token: res.body.token };

    // 새 토큰으로는 다시 붙는다
    const again = await connect(otherTv.token);
    again.socket.close();
    await again.closed;
  });

  it('기기를 끄면 연결을 4001로 닫고, 꺼진 기기는 인증하지 못한다', async () => {
    const conn = await connect(otherTv.token);
    await request(server())
      .patch(`/signage/devices/${otherTv.id}`)
      .set('Authorization', admin.authHeader)
      .send({ isActive: false })
      .expect(200);
    expect(await conn.closed).toBe(4001);

    const retry = open();
    retry.socket.once('open', () =>
      retry.socket.send(JSON.stringify({ type: 'auth', token: otherTv.token })),
    );
    expect(await retry.closed).toBe(4001);
  });
});
