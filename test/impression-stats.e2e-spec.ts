import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  addSeoulDays,
  seoulDate,
  startOfSeoulDay,
} from '../src/common/time/seoul-time.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  devices,
  playEventDaily,
  playEvents,
  submissions,
} from '../src/db/schema.js';
import { hashDeviceToken } from '../src/devices/auth/device-token.js';
import { PlayEventAggregationJob } from '../src/jobs/play-event-aggregation.job.js';
import {
  createReadyAsset,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

describe('노출 통계 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let job: PlayEventAggregationJob;
  let requester: TestUser;
  let other: TestUser;
  let reviewer: TestUser;
  let mine: string;
  let theirs: string;
  let deviceA: string;
  let deviceB: string;

  // 오늘 기준 상대 날짜라 언제 돌려도 보관 기간(90일) 안에 있다.
  const today = seoulDate(new Date());
  const day1 = addSeoulDays(today, -5);
  const day2 = addSeoulDays(today, -4);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // 파일 동안 포트를 하나로 고정한다. supertest가 요청마다 서버를 열고 닫으면
    // 동시 요청 중 하나가 닫힌 서버에 걸려 끊긴다(socket hang up).
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);
    job = app.get(PlayEventAggregationJob);

    requester = await createTestUser(app);
    other = await createTestUser(app);
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    mine = await insertSubmission(requester, '내 공연');
    theirs = await insertSubmission(other, '남의 공연');
    deviceA = await insertDevice();
    deviceB = await insertDevice();
  });

  afterAll(async () => {
    await db
      .delete(playEventDaily)
      .where(inArray(playEventDaily.submissionId, [mine, theirs]));
    // 기기를 지우면 원본 이벤트도 함께 지워진다.
    await db.delete(devices).where(inArray(devices.id, [deviceA, deviceB]));
    for (const user of [requester, other, reviewer]) {
      await user.remove();
    }
    await app.close();
  });

  async function insertSubmission(user: TestUser, title: string) {
    const assetId = await createReadyAsset(app, user.user.id);
    const now = new Date();
    const [row] = await db
      .insert(submissions)
      .values({
        requesterId: user.user.id,
        title,
        categoryId: 'performance',
        assetId,
        startAt: now,
        endAt: new Date(now.getTime() + 3600_000),
        status: 'PUBLISHED',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: submissions.id });
    return row.id;
  }

  async function insertDevice() {
    const now = new Date();
    const [row] = await db
      .insert(devices)
      .values({
        name: 'E2E 통계 TV',
        tokenHash: hashDeviceToken(`fgd_${randomUUID()}`),
        tokenIssuedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: devices.id });
    return row.id;
  }

  async function insertEvents(
    events: {
      submissionId: string;
      deviceId: string;
      startedAt: Date;
      completed?: boolean;
      durationMs?: number;
    }[],
  ) {
    await db.insert(playEvents).values(
      events.map((event) => ({
        deviceId: event.deviceId,
        eventId: randomUUID(),
        sessionId: 'ses_e2e',
        submissionId: event.submissionId,
        revision: 1,
        startedAt: event.startedAt,
        durationMs: event.durationMs ?? 10_000,
        completed: event.completed ?? true,
        receivedAt: new Date(),
      })),
    );
  }

  const dailyRows = () =>
    db
      .select({
        day: playEventDaily.day,
        submissionId: playEventDaily.submissionId,
        deviceId: playEventDaily.deviceId,
        impressions: playEventDaily.impressions,
        completedImpressions: playEventDaily.completedImpressions,
        totalDurationMs: playEventDaily.totalDurationMs,
      })
      .from(playEventDaily)
      .where(inArray(playEventDaily.submissionId, [mine, theirs]))
      .orderBy(playEventDaily.day, playEventDaily.submissionId);

  const at = (day: string, offsetMs: number) =>
    new Date(startOfSeoulDay(day).getTime() + offsetMs);

  describe('일별 집계', () => {
    it('서울 날짜·게시물·기기별로 모은다 (자정 경계 포함)', async () => {
      await insertEvents([
        // day1의 마지막 순간과 day2의 첫 순간
        { submissionId: mine, deviceId: deviceA, startedAt: at(day2, -1) },
        { submissionId: mine, deviceId: deviceA, startedAt: at(day2, 0) },
        {
          submissionId: mine,
          deviceId: deviceA,
          startedAt: at(day2, 3600_000),
          completed: false,
          durationMs: 4000,
        },
        {
          submissionId: mine,
          deviceId: deviceB,
          startedAt: at(day2, 7200_000),
        },
        { submissionId: theirs, deviceId: deviceB, startedAt: at(day1, 1000) },
      ]);

      expect(await job.run()).not.toBeNull();

      const rows = (await dailyRows()).filter(
        (row) => row.deviceId === deviceA || row.deviceId === deviceB,
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          {
            day: day1,
            submissionId: mine,
            deviceId: deviceA,
            impressions: 1,
            completedImpressions: 1,
            totalDurationMs: 10_000,
          },
          {
            day: day2,
            submissionId: mine,
            deviceId: deviceA,
            impressions: 2,
            completedImpressions: 1,
            totalDurationMs: 14_000,
          },
          {
            day: day2,
            submissionId: mine,
            deviceId: deviceB,
            impressions: 1,
            completedImpressions: 1,
            totalDurationMs: 10_000,
          },
          {
            day: day1,
            submissionId: theirs,
            deviceId: deviceB,
            impressions: 1,
            completedImpressions: 1,
            totalDurationMs: 10_000,
          },
        ]),
      );
      expect(rows).toHaveLength(4);
    });

    it('다시 돌려도 결과가 같다', async () => {
      const before = await dailyRows();
      await job.run();
      expect(await dailyRows()).toEqual(before);
    });

    it('며칠 늦게 도착한 이벤트도 그 날짜에 더해진다', async () => {
      await insertEvents([
        { submissionId: mine, deviceId: deviceA, startedAt: at(day1, 5000) },
      ]);
      await job.run();

      const [row] = await db
        .select({ impressions: playEventDaily.impressions })
        .from(playEventDaily)
        .where(
          and(
            eq(playEventDaily.day, day1),
            eq(playEventDaily.submissionId, mine),
            eq(playEventDaily.deviceId, deviceA),
          ),
        );
      expect(row.impressions).toBe(2);
    });

    it('보관 기간(90일)이 지난 원본은 지우고 집계하지 않는다', async () => {
      const old = addSeoulDays(today, -100);
      await insertEvents([
        { submissionId: mine, deviceId: deviceA, startedAt: at(old, 1000) },
      ]);

      const result = await job.run();
      expect(result!.rawDeleted).toBeGreaterThanOrEqual(1);

      const raw = await db
        .select()
        .from(playEvents)
        .where(
          and(
            eq(playEvents.submissionId, mine),
            eq(playEvents.startedAt, at(old, 1000)),
          ),
        );
      expect(raw).toEqual([]);
      expect((await dailyRows()).filter((row) => row.day === old)).toEqual([]);
    });
  });

  describe('통계 API', () => {
    const stats = (user: TestUser, query = '') =>
      request(app.getHttpServer())
        .get(`/signage/stats/impressions${query}`)
        .set('Authorization', user.authHeader);

    it('신청자는 기본 30일 동안의 내 게시물 통계를 본다', async () => {
      const res = await stats(requester).expect(200);

      expect(res.body).toMatchObject({
        from: addSeoulDays(today, -29),
        to: today,
        aggregatedAt: expect.any(String),
      });
      expect(res.body.items).toEqual([
        {
          submissionId: mine,
          title: '내 공연',
          impressions: 5,
          completedImpressions: 4,
          // 여러 날에 걸쳐도 기기는 한 번씩만 센다
          deviceCount: 2,
        },
      ]);
    });

    it('기간으로 거른다', async () => {
      const res = await stats(requester, `?from=${day2}&to=${day2}`).expect(
        200,
      );
      expect(res.body.items).toEqual([
        expect.objectContaining({
          submissionId: mine,
          impressions: 3,
          deviceCount: 2,
        }),
      ]);
    });

    it('검토자는 scope=all로 전체를 노출 많은 순으로 본다', async () => {
      const res = await stats(
        reviewer,
        `?scope=all&from=${day1}&to=${day2}`,
      ).expect(200);
      const ours = res.body.items.filter((item: { submissionId: string }) =>
        [mine, theirs].includes(item.submissionId),
      );
      expect(
        ours.map((item: { submissionId: string }) => item.submissionId),
      ).toEqual([mine, theirs]);
      await stats(requester, '?scope=all').expect(403);
    });

    it('잘못된 기간은 422', async () => {
      const res = await stats(requester, '?from=2026-02-30').expect(422);
      expect(res.body.fields).toEqual({ from: '없는 날짜입니다.' });
      await stats(requester, `?from=${day2}&to=${day1}`).expect(422);
      await stats(requester, '?from=2026/07/01').expect(422);
      await stats(requester, '?groupBy=device').expect(422);
    });

    it('로그인이 필요하다', async () => {
      await request(app.getHttpServer())
        .get('/signage/stats/impressions')
        .expect(401);
    });
  });
});
