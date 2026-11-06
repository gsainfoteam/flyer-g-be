import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import type { PlayEventDto } from '../src/device-telemetry/dto/play-events.dto.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  auditLogs,
  devices,
  playEvents,
  targetGroups,
} from '../src/db/schema.js';
import {
  createTestGroup,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

type RegisteredDevice = { id: string; token: string };

describe('기기 런타임 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let admin: TestUser;
  let tv: RegisteredDevice;
  let otherTv: RegisteredDevice;
  const deviceIds: string[] = [];
  let groupId: string;

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
    groupId = await createTestGroup(app);
    tv = await register();
    otherTv = await register();
  });

  afterAll(async () => {
    // 기기를 지우면 노출 이벤트도 함께 지워진다.
    await db.delete(auditLogs).where(inArray(auditLogs.targetId, deviceIds));
    await db.delete(devices).where(inArray(devices.id, deviceIds));
    await db.delete(targetGroups).where(eq(targetGroups.id, groupId));
    await admin.remove();
    await app.close();
  });

  async function register(): Promise<RegisteredDevice> {
    const res = await request(app.getHttpServer())
      .post('/signage/devices')
      .set('Authorization', admin.authHeader)
      .send({ name: 'E2E 런타임 TV', groupIds: [groupId] })
      .expect(201);
    deviceIds.push(res.body.id);
    return { id: res.body.id, token: res.body.token };
  }

  const heartbeat = (device: RegisteredDevice, body: object) =>
    request(app.getHttpServer())
      .post(`/signage/devices/${device.id}/heartbeat`)
      .set('X-Device-Token', device.token)
      .send(body);

  const sendEvents = (device: RegisteredDevice, events: object[]) =>
    request(app.getHttpServer())
      .post(`/signage/devices/${device.id}/play-events`)
      .set('X-Device-Token', device.token)
      .send({ events });

  const deviceDetail = (id: string) =>
    request(app.getHttpServer())
      .get(`/signage/devices/${id}`)
      .set('Authorization', admin.authHeader)
      .expect(200);

  const event = (overrides: Partial<PlayEventDto> = {}): PlayEventDto => ({
    eventId: randomUUID(),
    sessionId: 'ses_e2e',
    submissionId: randomUUID(),
    revision: 3,
    startedAt: '2026-07-29T06:28:00.000Z',
    durationMs: 10000,
    completed: true,
    ...overrides,
  });

  describe('heartbeat', () => {
    it('204이고 기기 상태에 반영된다', async () => {
      const before = await deviceDetail(tv.id);
      expect(before.body.status).toBe('OFFLINE');

      const res = await heartbeat(tv, {
        appVersion: '0.4.2',
        playlistVersion: '9f2b5c0e3a1d4f6b',
        lastRenderOkAt: '2026-07-29T06:29:50.000Z',
        resolution: { width: 1920, height: 1080 },
      }).expect(204);
      expect(res.text).toBe('');

      const after = await deviceDetail(tv.id);
      expect(after.body).toMatchObject({
        status: 'ONLINE',
        appVersion: '0.4.2',
        resolution: { width: 1920, height: 1080 },
        lastPlaylistVersion: '9f2b5c0e3a1d4f6b',
        lastRenderOkAt: '2026-07-29T06:29:50.000Z',
      });
      // 기기 시계가 아니라 서버가 받은 시각
      expect(
        Math.abs(new Date(after.body.lastSeenAt).getTime() - Date.now()),
      ).toBeLessThan(10_000);
    });

    it('첫 로드 전이면 playlistVersion·lastRenderOkAt이 없어도 된다', async () => {
      await heartbeat(tv, {
        appVersion: '0.4.3',
        playlistVersion: null,
        resolution: { width: 3840, height: 2160 },
      }).expect(204);

      const after = await deviceDetail(tv.id);
      expect(after.body).toMatchObject({
        appVersion: '0.4.3',
        lastPlaylistVersion: null,
        lastRenderOkAt: null,
      });
    });

    it('지금 장면(now)을 저장해 기기 응답에 그대로 싣는다', async () => {
      const submissionId = randomUUID();
      await heartbeat(tv, {
        appVersion: '0.5.0',
        resolution: { width: 1920, height: 1080 },
        now: {
          blockId: 'blk_cafeteria',
          live: false,
          kind: 'PROGRAM',
          label: '오늘의 학식',
          submissionIds: [submissionId],
          startedAt: '2026-10-30T12:09:52+09:00',
          endsAt: null,
        },
      }).expect(204);
      expect((await deviceDetail(tv.id)).body.now).toEqual({
        blockId: 'blk_cafeteria',
        live: false,
        kind: 'PROGRAM',
        label: '오늘의 학식',
        submissionIds: [submissionId],
        startedAt: '2026-10-30T03:09:52.000Z',
        endsAt: null,
      });

      // 보내지 않는 옛 플레이어는 null
      await heartbeat(tv, {
        appVersion: '0.4.3',
        resolution: { width: 1920, height: 1080 },
      }).expect(204);
      expect((await deviceDetail(tv.id)).body.now).toBeNull();
    });

    it('지금 장면 형식이 틀리면 422', async () => {
      const res = await heartbeat(tv, {
        appVersion: '0.5.0',
        resolution: { width: 1920, height: 1080 },
        now: {
          blockId: null,
          live: 'no',
          kind: 'DANCE',
          label: null,
          submissionIds: ['x'],
          startedAt: '2026-10-30T03:09:52',
          endsAt: null,
        },
      }).expect(422);
      expect(res.body.fields).toEqual({
        'now.live': 'live가 올바르지 않습니다.',
        'now.kind': '장면 종류가 올바르지 않습니다.',
        'now.submissionIds': '신청 ID가 올바르지 않습니다.',
        'now.startedAt': '시간대가 있는 ISO 시각이어야 합니다.',
      });
    });

    it('화면 끔 시간에는 heartbeat와 상관없이 SLEEPING', async () => {
      const device = await register();
      // 서울 지금 시각 앞뒤 1시간
      const minute = Math.floor((Date.now() + 9 * 3600_000) / 60_000) % 1440;
      const clock = (m: number) => {
        const wrapped = (m + 1440) % 1440;
        return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
      };
      const quietHours = [
        { start: clock(minute - 60), end: clock(minute + 60) },
      ];
      const patchOverrides = (overrides: object) =>
        request(app.getHttpServer())
          .patch(`/signage/devices/${device.id}`)
          .set('Authorization', admin.authHeader)
          .send({ overrides })
          .expect(200);

      const sleeping = await patchOverrides({ settings: { quietHours } });
      expect(sleeping.body.status).toBe('SLEEPING');
      await heartbeat(device, {
        appVersion: '0.5.0',
        resolution: { width: 1920, height: 1080 },
      }).expect(204);
      expect((await deviceDetail(device.id)).body.status).toBe('SLEEPING');

      const awake = await patchOverrides({});
      expect(awake.body.status).toBe('ONLINE');
    });

    it('형식이 틀리면 422', async () => {
      const res = await heartbeat(tv, {
        appVersion: '',
        resolution: { width: 0 },
      }).expect(422);
      expect(Object.keys(res.body.fields)).toEqual(
        expect.arrayContaining([
          'appVersion',
          'resolution.width',
          'resolution.height',
        ]),
      );
    });

    it('기기 토큰이 없으면 401, 다른 기기 경로면 403', async () => {
      await request(app.getHttpServer())
        .post(`/signage/devices/${tv.id}/heartbeat`)
        .send({})
        .expect(401);
      await request(app.getHttpServer())
        .post(`/signage/devices/${otherTv.id}/heartbeat`)
        .set('X-Device-Token', tv.token)
        .send({ appVersion: '1', resolution: { width: 1, height: 1 } })
        .expect(403);
    });
  });

  describe('노출 이벤트', () => {
    const storedIds = async (device: RegisteredDevice) =>
      (
        await db
          .select({ eventId: playEvents.eventId })
          .from(playEvents)
          .where(eq(playEvents.deviceId, device.id))
      ).map((row) => row.eventId);

    it('저장하고, 같은 batch를 다시 보내면 중복으로 건너뛴다', async () => {
      const batch = [event(), event(), event({ revision: null })];

      const first = await sendEvents(tv, batch).expect(200);
      expect(first.body).toEqual({ accepted: 3, duplicates: 0 });

      const resent = await sendEvents(tv, batch).expect(200);
      expect(resent.body).toEqual({ accepted: 0, duplicates: 3 });

      expect(await storedIds(tv)).toEqual(
        expect.arrayContaining(batch.map((e) => e.eventId)),
      );
    });

    it('같은 요청 안의 중복도 하나만 저장한다', async () => {
      const once = event();
      const res = await sendEvents(tv, [once, once, event()]).expect(200);
      expect(res.body).toEqual({ accepted: 2, duplicates: 1 });
    });

    it('같은 eventId라도 기기가 다르면 따로 저장한다', async () => {
      const shared = event();
      await sendEvents(tv, [shared]).expect(200);
      const res = await sendEvents(otherTv, [shared]).expect(200);
      expect(res.body).toEqual({ accepted: 1, duplicates: 0 });
    });

    it('저장한 값이 그대로다', async () => {
      const sent = event({ completed: false, durationMs: 3500 });
      await sendEvents(tv, [sent]).expect(200);

      const [row] = await db
        .select()
        .from(playEvents)
        .where(eq(playEvents.eventId, sent.eventId));
      expect(row).toMatchObject({
        deviceId: tv.id,
        sessionId: 'ses_e2e',
        submissionId: sent.submissionId,
        revision: 3,
        durationMs: 3500,
        completed: false,
        // 예전 플레이어는 보내지 않는다
        placement: null,
      });
      expect(row.startedAt.toISOString()).toBe(sent.startedAt);
    });

    it('보인 자리(placement)를 저장하고, 모르는 값은 422', async () => {
      const sent = [
        event({ placement: 'WALL' }),
        event({ placement: 'SPOTLIGHT' }),
        event({ placement: 'STRIP' }),
        event({ placement: null }),
      ];
      await sendEvents(tv, sent).expect(200);

      const rows = await db
        .select({
          eventId: playEvents.eventId,
          placement: playEvents.placement,
        })
        .from(playEvents)
        .where(
          inArray(
            playEvents.eventId,
            sent.map((e) => e.eventId),
          ),
        );
      expect(rows).toEqual(
        expect.arrayContaining(
          sent.map((e) => ({ eventId: e.eventId, placement: e.placement })),
        ),
      );

      const res = await sendEvents(tv, [
        { ...event(), placement: 'GRID' },
      ]).expect(422);
      expect(Object.keys(res.body.fields)).toEqual(['events.0.placement']);
    });

    it('빈 목록은 200', async () => {
      const res = await sendEvents(tv, []).expect(200);
      expect(res.body).toEqual({ accepted: 0, duplicates: 0 });
    });

    it('300개는 본문 한도 안에 들어가고, 301개는 422', async () => {
      // 긴 값으로 채워도 JSON 본문 한도(100KB)를 넘지 않아야 한다.
      const longSession = 'ses_'.padEnd(64, 'x');
      const full = Array.from({ length: 300 }, () =>
        event({ sessionId: longSession }),
      );
      expect(Buffer.byteLength(JSON.stringify({ events: full }))).toBeLessThan(
        100 * 1024,
      );
      const res = await sendEvents(tv, full).expect(200);
      expect(res.body.accepted).toBe(300);

      const tooMany = Array.from({ length: 301 }, () => event());
      const rejected = await sendEvents(tv, tooMany).expect(422);
      expect(rejected.body.fields).toEqual({
        events: '한 번에 최대 300개까지 보낼 수 있습니다.',
      });
    });

    it('형식이 틀린 이벤트는 위치와 함께 422', async () => {
      const res = await sendEvents(tv, [
        event(),
        event({ eventId: 'not-uuid', durationMs: -1 }),
      ]).expect(422);
      expect(Object.keys(res.body.fields)).toEqual(
        expect.arrayContaining(['events.1.eventId', 'events.1.durationMs']),
      );
    });

    it('기기 토큰이 없으면 401', async () => {
      await request(app.getHttpServer())
        .post(`/signage/devices/${tv.id}/play-events`)
        .send({ events: [] })
        .expect(401);
    });
  });
});
