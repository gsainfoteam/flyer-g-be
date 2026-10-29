import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module.js';
import { RELAY_LIMITS } from '../src/games/game-relay.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { devices } from '../src/db/schema.js';
import {
  generateDeviceToken,
  hashDeviceToken,
} from '../src/devices/auth/device-token.js';

const ORIGIN = 'http://localhost:5173';

/** 다음 메시지(JSON) 하나를 기다린다. */
function nextFrame(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) =>
    socket.once('message', (raw) => resolve(JSON.parse(raw.toString()))),
  );
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function closedWith(socket: WebSocket): Promise<number> {
  return new Promise((resolve) =>
    socket.once('close', (code) => resolve(code)),
  );
}

describe('게임 중계 WebSocket (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let base: string;
  const token = generateDeviceToken();
  const otherToken = generateDeviceToken();
  let deviceId: string;
  let otherDeviceId: string;
  const sockets: WebSocket[] = [];

  const connect = (query: string, origin = ORIGIN) => {
    const socket = new WebSocket(`${base}/games/ws?${query}`, { origin });
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `ws://127.0.0.1:${port}`;
    db = app.get<Database>(DB_CONNECTION);

    const now = new Date();
    const rows = await db
      .insert(devices)
      .values([
        {
          name: 'E2E 게임 TV',
          tokenHash: hashDeviceToken(token),
          tokenIssuedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          name: 'E2E 다른 TV',
          tokenHash: hashDeviceToken(otherToken),
          tokenIssuedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .returning({ id: devices.id });
    deviceId = rows[0]!.id;
    otherDeviceId = rows[1]!.id;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.terminate();
    await db
      .delete(devices)
      .where(inArray(devices.id, [deviceId, otherDeviceId]));
    await app.close();
  });

  it('TV가 자기 기기 토큰으로 방을 열면 폰과 메시지가 오간다', async () => {
    const host = connect(`room=${deviceId}&role=host`);
    await opened(host);
    host.send(JSON.stringify({ type: 'auth', token }));
    expect(await nextFrame(host)).toEqual({ type: 'ready' });

    const phone = connect(`room=${deviceId}&role=player`);
    const hello = nextFrame(phone);
    await opened(phone);
    expect(await hello).toEqual({ type: 'host', online: true });

    const toHost = nextFrame(host);
    phone.send(JSON.stringify({ type: 'send', data: { kind: 'join' } }));
    expect(await toHost).toMatchObject({
      type: 'message',
      data: { kind: 'join' },
    });

    const toPhone = nextFrame(phone);
    host.send(JSON.stringify({ type: 'send', data: { kind: 'state' } }));
    expect(await toPhone).toEqual({ type: 'message', data: { kind: 'state' } });

    const left = nextFrame(host);
    phone.close();
    expect(await left).toMatchObject({ type: 'left' });
  });

  it('다른 기기의 토큰이나 틀린 토큰으로는 방을 열 수 없다', async () => {
    const wrongRoom = connect(`room=${deviceId}&role=host`);
    await opened(wrongRoom);
    const forbidden = closedWith(wrongRoom);
    wrongRoom.send(JSON.stringify({ type: 'auth', token: otherToken }));
    expect(await forbidden).toBe(4003);

    const bad = connect(`room=${deviceId}&role=host`);
    await opened(bad);
    const unauthorized = closedWith(bad);
    bad.send(JSON.stringify({ type: 'auth', token: 'fgd_nope' }));
    expect(await unauthorized).toBe(4001);
  });

  it('허용하지 않은 Origin과 잘못된 파라미터는 연결하지 않는다', async () => {
    const evil = connect(
      `room=${deviceId}&role=player`,
      'https://evil.example',
    );
    await expect(opened(evil)).rejects.toThrow(/403/);

    const badRole = connect(`room=${deviceId}&role=admin`);
    await expect(opened(badRole)).rejects.toThrow(/400/);
  });

  it('참가자는 실제 기기의 방에만 붙는다', async () => {
    const missing = connect(
      'room=00000000-0000-4000-8000-000000000000&role=player',
    );
    await expect(opened(missing)).rejects.toThrow(/404/);
    const notUuid = connect('room=lobby-a&role=player');
    await expect(opened(notUuid)).rejects.toThrow(/404/);
  });

  it('한 IP가 한 방을 채우지 못한다', async () => {
    const mine: WebSocket[] = [];
    for (
      let index = 0;
      index < RELAY_LIMITS.maxConnectionsPerIpPerRoom;
      index++
    ) {
      const socket = connect(`room=${otherDeviceId}&role=player`);
      mine.push(socket);
      await opened(socket);
    }
    const extra = connect(`room=${otherDeviceId}&role=player`);
    await expect(opened(extra)).rejects.toThrow(/429/);

    // 하나가 나가면 다시 들어올 수 있다.
    const left = closedWith(mine[0]!);
    mine[0]!.close();
    await left;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const again = connect(`room=${otherDeviceId}&role=player`);
    await opened(again);
  });

  it('다른 경로의 upgrade 요청은 이전처럼 닫힌다', async () => {
    const socket = new WebSocket(`${base}/playlist`, { origin: ORIGIN });
    sockets.push(socket);
    await expect(opened(socket)).rejects.toThrow();
  });

  it('게임 모듈이 있어도 기존 HTTP API는 그대로다', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
