import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { eq, like, or, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  devices,
  assets,
  deviceAlertStates,
  slackDeliveryState,
  slackNotifications,
  submissions,
  targetGroups,
} from '../src/db/schema.js';
import { DeviceOfflineAlertJob } from '../src/jobs/device-offline-alert.job.js';
import { ReviewReminderJob } from '../src/jobs/review-reminder.job.js';
import { SchedulerService } from '../src/jobs/scheduler.service.js';
import { NotificationDispatcher } from '../src/notifications/notification-dispatcher.service.js';
import type { NotificationMessage } from '../src/notifications/notification-presentation.js';
import {
  SlackDeliveryError,
  SlackNotificationService,
} from '../src/notifications/slack-notification.service.js';
import {
  createTestGroup,
  createTestUser,
  createReadyAsset,
  type TestUser,
} from './helpers/test-user.js';

// 테스트 전용 DB에서 실행한다. 실제 Slack/IdP/S3에는 요청하지 않는다.
describe('슬랙 알림 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let user: TestUser;
  let groupId: string;
  let deviceId: string;
  let deviceJob: DeviceOfflineAlertJob;
  let reviewJob: ReviewReminderJob;
  let dispatcher: NotificationDispatcher;
  const now = new Date('2035-11-05T01:00:00Z'); // 월요일 10:00 KST
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  const slack = {
    enabled: true,
    enabledFor: vi.fn(() => true),
    send: vi.fn(async (_message: NotificationMessage) => {}),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SlackNotificationService)
      .useValue(slack)
      .compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(DB_CONNECTION);
    user = await createTestUser(app);
    groupId = await createTestGroup(app);
    deviceJob = app.get(DeviceOfflineAlertJob);
    reviewJob = app.get(ReviewReminderJob);
    dispatcher = app.get(NotificationDispatcher);
  });

  beforeEach(async () => {
    slack.enabled = true;
    slack.enabledFor.mockReset().mockReturnValue(true);
    slack.send.mockReset().mockResolvedValue(undefined);
    const [device] = await db
      .insert(devices)
      .values({
        name: '알림 테스트 TV',
        location: '로비',
        programGroupId: groupId,
        tokenHash: randomUUID(),
        tokenIssuedAt: later(-3600),
        createdAt: later(-3600),
        updatedAt: later(-3600),
        lastSeenAt: later(-120),
      })
      .returning();
    deviceId = device.id;
    await db
      .delete(slackDeliveryState)
      .where(eq(slackDeliveryState.id, 'slack'));
  });

  afterEach(async () => {
    await db
      .delete(slackNotifications)
      .where(
        or(
          like(slackNotifications.dedupeKey, 'review:2035-%'),
          like(slackNotifications.dedupeKey, 'notification-e2e:%'),
        ),
      );
    await db.delete(devices).where(eq(devices.id, deviceId));
    await db
      .delete(submissions)
      .where(eq(submissions.requesterId, user.user.id));
    await db
      .delete(slackDeliveryState)
      .where(eq(slackDeliveryState.id, 'slack'));
  });

  afterAll(async () => {
    if (db && groupId)
      await db.delete(targetGroups).where(eq(targetGroups.id, groupId));
    if (user) {
      await db.delete(assets).where(eq(assets.ownerId, user.user.id));
      await user.remove();
    }
    await app?.close();
  });

  async function notifications() {
    return db
      .select()
      .from(slackNotifications)
      .where(eq(slackNotifications.deviceId, deviceId));
  }

  async function enqueue() {
    const [row] = await db
      .insert(slackNotifications)
      .values({
        dedupeKey: `notification-e2e:${randomUUID()}`,
        kind: 'REVIEW_REMINDER',
        text: '승인 대기 1건',
        createdAt: now,
        availableAt: now,
        expiresAt: later(3600),
      })
      .returning();
    return row;
  }

  it('동시 감지와 서비스 재생성에도 같은 장애는 한 번만 생성한다', async () => {
    await Promise.all([deviceJob.run(now), deviceJob.run(now)]);
    expect(await notifications()).toHaveLength(1);
    const restarted = new DeviceOfflineAlertJob(
      db,
      slack as unknown as SlackNotificationService,
    );
    await restarted.run(later(60));
    expect(await notifications()).toHaveLength(1);
    await dispatcher.run(now);
    expect(slack.send).toHaveBeenCalledTimes(1);
    expect(slack.send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'DEVICE_OFFLINE',
        text: expect.stringContaining('알림 테스트 TV'),
        presentation: expect.objectContaining({
          title: '📺 TV 연결 끊김',
          color: '#E01E5A',
        }),
      }),
    );
    expect((await notifications())[0].status).toBe('SENT');
  });

  it('복구 후 다시 끊기면 새 장애를 만들고 복구된 과거 알림은 취소한다', async () => {
    await deviceJob.run(now);
    await db
      .update(devices)
      .set({ lastSeenAt: later(30) })
      .where(eq(devices.id, deviceId));
    await dispatcher.run(later(30));
    expect(slack.send).not.toHaveBeenCalled();
    expect((await notifications())[0].status).toBe('CANCELED');
    await deviceJob.run(later(60));
    await deviceJob.run(later(180));
    expect(await notifications()).toHaveLength(2);
    await dispatcher.run(later(180));
    expect(slack.send).toHaveBeenCalledTimes(1);
  });

  it('미접속·비활성·기기별 quietHours는 알림에서 제외한다', async () => {
    await db
      .update(devices)
      .set({ lastSeenAt: null })
      .where(eq(devices.id, deviceId));
    await deviceJob.run(now);
    await db
      .update(devices)
      .set({ lastSeenAt: later(-120), isActive: false })
      .where(eq(devices.id, deviceId));
    await deviceJob.run(later(1));
    await db
      .update(devices)
      .set({
        isActive: true,
        lineupOverrides: {
          settings: { quietHours: [{ start: '09:00', end: '11:00' }] },
          blocks: {},
        },
      })
      .where(eq(devices.id, deviceId));
    await deviceJob.run(later(2));
    expect(await notifications()).toHaveLength(0);
    const [state] = await db
      .select()
      .from(deviceAlertStates)
      .where(eq(deviceAlertStates.deviceId, deviceId));
    expect(state.status).toBe('SLEEPING');
  });

  it('다른 파드가 감지 잠금을 잡고 있으면 건너뛴다', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(1179207270::int, 5::int)`,
      );
      expect(await deviceJob.run(now)).toBeNull();
    });
  });

  it('현재 대기 건수만 집계하고 같은 시각은 중복 없이, 오후에는 다시 알린다', async () => {
    const assetId = await createReadyAsset(app, user.user.id);
    await db.insert(submissions).values([
      {
        requesterId: user.user.id,
        type: 'POSTER',
        categoryId: 'event',
        assetId,
        title: '포스터',
        status: 'PENDING_REVIEW',
        submittedAt: later(-7200),
        createdAt: later(-7200),
        updatedAt: now,
      },
      {
        requesterId: user.user.id,
        type: 'STORY',
        title: '제보',
        status: 'PENDING_REVIEW',
        submittedAt: null,
        createdAt: later(-3600),
        updatedAt: now,
      },
      {
        requesterId: user.user.id,
        type: 'EVENT_BANNER',
        title: '반려됨',
        status: 'REJECTED',
        submittedAt: later(-3600),
        createdAt: later(-3600),
        updatedAt: now,
      },
    ]);
    await Promise.all([reviewJob.run(now), reviewJob.run(now)]);
    await reviewJob.run(later(30));
    const rows = await db
      .select()
      .from(slackNotifications)
      .where(like(slackNotifications.dedupeKey, 'review:2035-%'));
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toContain('승인 대기 요청이 2건');
    expect(rows[0].text).toContain('포스터 1건 · 이벤트 배너 0건 · 제보 1건');
    expect(rows[0].presentation).toMatchObject({
      title: '📋 승인 대기 리마인드',
      color: '#2EB67D',
    });
    expect(await reviewJob.run(later(6 * 3600))).toEqual({ queued: 1 });
  });

  it('0건과 주말에는 보내지 않는다', async () => {
    expect(await reviewJob.run(now)).toEqual({ queued: 0 });
    expect(await reviewJob.run(new Date('2035-11-10T01:00:00Z'))).toBeNull();
  });

  it('동시 발송에서는 한 파드만 전송하고 요청 중에도 DB 트랜잭션은 열어두지 않는다', async () => {
    await enqueue();
    let finish!: () => void;
    let started!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    slack.send.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const first = dispatcher.run(now);
    await sending;
    try {
      expect(await dispatcher.run(later(5))).toBeNull();
      // 별도 커넥션에서 리스 행을 읽고 잠글 수 있어야 한다.
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '100ms'`);
        await tx.select().from(slackDeliveryState).for('update');
      });
    } finally {
      finish();
      await first;
    }
    expect(slack.send).toHaveBeenCalledTimes(1);
  });

  it('전송 실패는 백오프 뒤 재시도하며 429는 전체 웹훅을 쉬게 한다', async () => {
    const row = await enqueue();
    slack.send.mockRejectedValueOnce(
      new SlackDeliveryError('SLACK_RATE_LIMITED', true, 120_000),
    );
    await dispatcher.run(now);
    const [pending] = await db
      .select()
      .from(slackNotifications)
      .where(eq(slackNotifications.id, row.id));
    expect(pending).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastError: 'SLACK_RATE_LIMITED',
    });
    await enqueue();
    expect(await dispatcher.run(later(60))).toBeNull();
    await dispatcher.run(later(121));
    expect(slack.send).toHaveBeenCalledTimes(2);
  });

  it('영구 오류와 최대 재시도 초과는 FAILED로 남긴다', async () => {
    const row = await enqueue();
    slack.send.mockRejectedValueOnce(
      new SlackDeliveryError('SLACK_HTTP_403', false),
    );
    await dispatcher.run(now);
    expect(
      (
        await db
          .select()
          .from(slackNotifications)
          .where(eq(slackNotifications.id, row.id))
      )[0].status,
    ).toBe('FAILED');
    const retry = await enqueue();
    await db
      .update(slackNotifications)
      .set({ attempts: 4 })
      .where(eq(slackNotifications.id, retry.id));
    slack.send.mockRejectedValueOnce(
      new SlackDeliveryError('SLACK_NETWORK_ERROR', true),
    );
    await dispatcher.run(later(5));
    expect(
      (
        await db
          .select()
          .from(slackNotifications)
          .where(eq(slackNotifications.id, retry.id))
      )[0],
    ).toMatchObject({ status: 'FAILED', attempts: 5 });
  });

  it('발송 중 죽은 파드의 만료된 리스를 회수한다', async () => {
    const row = await enqueue();
    const token = randomUUID();
    await db
      .update(slackNotifications)
      .set({ status: 'SENDING', attempts: 1, claimToken: token })
      .where(eq(slackNotifications.id, row.id));
    await db.insert(slackDeliveryState).values({
      id: 'slack',
      claimToken: token,
      lockedUntil: later(60),
      nextSendAt: now,
    });
    expect(await dispatcher.run(later(30))).toBeNull();
    await dispatcher.run(later(61));
    expect(slack.send).toHaveBeenCalledTimes(1);
    expect(
      (
        await db
          .select()
          .from(slackNotifications)
          .where(eq(slackNotifications.id, row.id))
      )[0],
    ).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('1시간 지난 알림은 재시도하지 않는다', async () => {
    const row = await enqueue();
    await dispatcher.run(later(3601));
    expect(slack.send).not.toHaveBeenCalled();
    expect(
      (
        await db
          .select()
          .from(slackNotifications)
          .where(eq(slackNotifications.id, row.id))
      )[0].status,
    ).toBe('CANCELED');
  });

  it('스케줄러·기능 비활성화는 생성과 발송에 적용된다', async () => {
    const scheduler = app.get(SchedulerService);
    await scheduler.detectOfflineDevices();
    await scheduler.remindPendingReviews();
    await scheduler.dispatchNotifications();
    expect(await notifications()).toHaveLength(0);
    slack.enabledFor.mockReturnValue(false);
    expect(await deviceJob.run(now)).toBeNull();
    expect(await reviewJob.run(now)).toBeNull();
    slack.enabled = false;
    expect(await dispatcher.run(now)).toBeNull();
  });

  it('실제 cron 등록도 한국 시간 평일 10시·16시를 따른다', () => {
    const job = app.get(SchedulerRegistry).getCronJob('review-reminder');
    const next = (date: string) =>
      job.cronTime
        .getNextDateFrom(new Date(date), 'Asia/Seoul')
        .toUTC()
        .toISO();
    expect(next('2026-11-06T00:59:59Z')).toBe('2026-11-06T01:00:00.000Z');
    expect(next('2026-11-06T01:00:00Z')).toBe('2026-11-06T07:00:00.000Z');
    expect(next('2026-11-06T07:00:00Z')).toBe('2026-11-09T01:00:00.000Z');
  });
});
