import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { auditLogs, devices, submissions, users } from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import { MemoryStorage } from './helpers/memory-storage.js';
import {
  createReadyAsset,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

const HOUR = 3600_000;

describe('감사 로그 조회 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let requester: TestUser;
  let other: TestUser;
  let reviewer: TestUser;
  let submissionId: string;
  let othersSubmissionId: string;
  let approveRequestId: string;
  const deviceId = randomUUID();
  const missingTargetId = randomUUID();
  let secondSubmissionId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new MemoryStorage())
      .compile();
    app = moduleRef.createNestApplication();
    // 파일 동안 포트를 하나로 고정한다. supertest가 요청마다 서버를 열고 닫으면
    // 동시 요청 중 하나가 닫힌 서버에 걸려 끊긴다(socket hang up).
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);

    requester = await createTestUser(app);
    other = await createTestUser(app);
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });

    submissionId = await submit(requester);
    othersSubmissionId = await submit(other);
    const approved = await request(app.getHttpServer())
      .post(`/signage/submissions/${submissionId}/approve`)
      .set('Authorization', reviewer.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(200);
    approveRequestId = approved.headers['x-request-id'];

    // 주기 작업이 남긴 기록
    await db.insert(auditLogs).values({
      actorType: 'SYSTEM',
      actorId: null,
      action: 'SUBMISSION_PUBLISHED',
      targetType: 'SUBMISSION',
      targetId: submissionId,
      metadata: { toStatus: 'PUBLISHED' },
      createdAt: new Date(Date.now() + 1000),
    });
  });

  afterAll(async () => {
    await db
      .delete(auditLogs)
      .where(
        inArray(auditLogs.targetId, [
          submissionId,
          othersSubmissionId,
          deviceId,
          missingTargetId,
          ...(secondSubmissionId ? [secondSubmissionId] : []),
        ]),
      );
    await db.delete(devices).where(eq(devices.id, deviceId));
    await requester.remove();
    await other.remove();
    await reviewer.remove();
    await app.close();
  });

  async function submit(user: TestUser): Promise<string> {
    const assetId = await createReadyAsset(app, user.user.id);
    const res = await request(app.getHttpServer())
      .post('/signage/submissions')
      .set('Authorization', user.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send({
        title: '감사 로그 대상',
        categoryId: 'event',
        assetId,
        startAt: new Date(Date.now() + 48 * HOUR).toISOString(),
        endAt: new Date(Date.now() + 96 * HOUR).toISOString(),
      })
      .expect(201);
    return res.body.id;
  }

  const list = (user: TestUser, query = '') =>
    request(app.getHttpServer())
      .get(`/signage/audit-logs${query}`)
      .set('Authorization', user.authHeader);

  it('검토자는 신청의 로그를 최신순으로, 행위자 이름·요청 ID와 함께 본다', async () => {
    const res = await list(
      reviewer,
      `?targetType=SUBMISSION&targetId=${submissionId}`,
    ).expect(200);

    expect(res.body.totalCount).toBe(3);
    expect(res.body.items.map((log: { action: string }) => log.action)).toEqual(
      ['SUBMISSION_PUBLISHED', 'SUBMISSION_APPROVED', 'SUBMISSION_CREATED'],
    );

    const [system, approve, create] = res.body.items;
    expect(system).toMatchObject({
      actorType: 'SYSTEM',
      actorId: null,
      actorName: null,
      requestId: null,
    });
    expect(approve).toMatchObject({
      actorType: 'USER',
      actorId: reviewer.user.id,
      actorName: 'E2E 사용자',
      targetType: 'SUBMISSION',
      targetId: submissionId,
      requestId: approveRequestId,
      metadata: expect.objectContaining({
        revision: 1,
        toStatus: 'SCHEDULED',
      }),
    });
    expect(create).toMatchObject({
      actorId: requester.user.id,
      reason: null,
    });
  });

  it('검토자는 필터 없이 전체를 보고, 행위로 거를 수 있다', async () => {
    await list(reviewer).expect(200);
    const res = await list(
      reviewer,
      `?action=SUBMISSION_APPROVED&targetId=${submissionId}`,
    ).expect(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('행위를 쉼표로 여러 개 보내면 그중 하나에 해당하는 로그를 준다', async () => {
    const actions = (res: { body: { items: { action: string }[] } }) =>
      res.body.items.map((log) => log.action);

    const res = await list(
      reviewer,
      `?targetId=${submissionId}&action=SUBMISSION_APPROVED,SUBMISSION_REJECTED,SUBMISSION_CREATED`,
    ).expect(200);
    expect(actions(res)).toEqual(['SUBMISSION_APPROVED', 'SUBMISSION_CREATED']);
    expect(res.body.totalCount).toBe(2);

    // 공백·중복을 허용하고, 같은 이름을 여러 번 보내도 같게 받는다
    const spaced = await list(
      reviewer,
      `?targetId=${submissionId}&action=SUBMISSION_APPROVED,%20SUBMISSION_APPROVED`,
    ).expect(200);
    expect(actions(spaced)).toEqual(['SUBMISSION_APPROVED']);
    const repeated = await list(
      reviewer,
      `?targetId=${submissionId}&action=SUBMISSION_APPROVED&action=SUBMISSION_PUBLISHED`,
    ).expect(200);
    expect(actions(repeated)).toEqual([
      'SUBMISSION_PUBLISHED',
      'SUBMISSION_APPROVED',
    ]);
  });

  it('모르는 행위가 섞이면 422', async () => {
    const res = await list(
      reviewer,
      '?action=SUBMISSION_APPROVED,SUBMISSION_UNKNOWN',
    ).expect(422);
    expect(res.body.fields).toHaveProperty('action');
    await list(reviewer, '?action=SUBMISSION_APPROVED,').expect(422);
  });

  it('cursor로 이어 받으면 겹치지 않는다', async () => {
    const query = `?targetType=SUBMISSION&targetId=${submissionId}&limit=2`;
    const first = await list(reviewer, query).expect(200);
    expect(first.body.items).toHaveLength(2);
    const second = await list(
      reviewer,
      `${query}&cursor=${first.body.nextCursor}`,
    ).expect(200);

    expect(
      second.body.items.map((log: { action: string }) => log.action),
    ).toEqual(['SUBMISSION_CREATED']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('신청자는 본인 신청의 로그만 본다', async () => {
    const own = await list(
      requester,
      `?targetType=SUBMISSION&targetId=${submissionId}`,
    ).expect(200);
    expect(own.body.totalCount).toBe(3);

    await list(requester).expect(403);
    await list(
      requester,
      `?targetType=SUBMISSION&targetId=${othersSubmissionId}`,
    ).expect(403);
    await list(requester, `?targetType=DEVICE&targetId=${submissionId}`).expect(
      403,
    );
    await list(requester, '?targetType=SUBMISSION&targetId=not-a-uuid').expect(
      403,
    );
  });

  it('신청자가 targetId를 비우면 본인 신청 전체의 로그만 최신순으로 본다', async () => {
    secondSubmissionId = await submit(requester);
    const own = new Set([submissionId, secondSubmissionId]);

    const res = await list(requester, '?targetType=SUBMISSION').expect(200);
    expect(res.body.totalCount).toBe(4);
    expect(
      res.body.items.every(
        (log: { targetType: string; targetId: string }) =>
          log.targetType === 'SUBMISSION' && own.has(log.targetId),
      ),
    ).toBe(true);
    const times = res.body.items.map(
      (log: { createdAt: string }) => log.createdAt,
    );
    expect(times).toEqual([...times].sort().reverse());
    expect(
      res.body.items.find(
        (log: { targetId: string }) => log.targetId === secondSubmissionId,
      ),
    ).toMatchObject({
      action: 'SUBMISSION_CREATED',
      targetTitle: '감사 로그 대상',
    });

    // 행위 필터와 함께 쓸 수 있다
    const approved = await list(
      requester,
      '?targetType=SUBMISSION&action=SUBMISSION_APPROVED,SUBMISSION_PUBLISHED',
    ).expect(200);
    expect(
      approved.body.items.map((log: { action: string }) => log.action),
    ).toEqual(['SUBMISSION_PUBLISHED', 'SUBMISSION_APPROVED']);

    // 다른 사용자는 자기 신청만 본다
    const others = await list(other, '?targetType=SUBMISSION').expect(200);
    expect(
      others.body.items.map((log: { targetId: string }) => log.targetId),
    ).toEqual([othersSubmissionId]);

    // 검토자는 targetId를 비우면 전체를 본다
    const all = await list(reviewer, '?targetType=SUBMISSION&limit=100').expect(
      200,
    );
    expect(all.body.totalCount).toBeGreaterThanOrEqual(5);

    // targetType 없이, 또는 DEVICE로는 여전히 볼 수 없다
    await list(requester).expect(403);
    await list(requester, '?targetType=DEVICE').expect(403);
  });

  it('형식이 틀린 필터는 422', async () => {
    await list(reviewer, '?targetType=ACCOUNT').expect(422);
    await list(reviewer, '?action=approved').expect(422);
  });

  it('대상의 현재 제목·기기 이름을 targetTitle로 주고, 대상이 없으면 null', async () => {
    const now = new Date();
    await db.insert(devices).values({
      id: deviceId,
      name: '학생회관 1층 TV',
      tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      tokenIssuedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(auditLogs).values([
      {
        actorType: 'SYSTEM',
        action: 'DEVICE_UPDATED',
        targetType: 'DEVICE',
        targetId: deviceId,
        createdAt: now,
      },
      {
        actorType: 'SYSTEM',
        action: 'SUBMISSION_ENDED',
        targetType: 'SUBMISSION',
        targetId: missingTargetId,
        createdAt: now,
      },
    ]);
    // 로그를 쓴 뒤 제목이 바뀌어도 지금 제목을 준다
    await db
      .update(submissions)
      .set({ title: '바뀐 제목' })
      .where(eq(submissions.id, submissionId));

    const titleOf = async (targetId: string) => {
      const res = await list(reviewer, `?targetId=${targetId}`).expect(200);
      return res.body.items.map(
        (log: { targetTitle: string | null }) => log.targetTitle,
      );
    };
    expect(await titleOf(submissionId)).toEqual(Array(3).fill('바뀐 제목'));
    expect(await titleOf(deviceId)).toEqual(['학생회관 1층 TV']);
    expect(await titleOf(missingTargetId)).toEqual([null]);
  });

  it('로그인이 필요하다', async () => {
    await request(app.getHttpServer()).get('/signage/audit-logs').expect(401);
  });

  it('사용자를 지우면 행위자 이름은 null이 된다', async () => {
    const temp = await createTestUser(app);
    await db.insert(auditLogs).values({
      actorType: 'USER',
      actorId: temp.user.id,
      action: 'SUBMISSION_UPDATED',
      targetType: 'SUBMISSION',
      targetId: submissionId,
      createdAt: new Date(Date.now() + 2000),
    });
    // remove()는 그 사용자의 감사 로그도 지우므로 사용자 행만 지운다
    await db.delete(users).where(eq(users.id, temp.user.id));

    const res = await list(
      reviewer,
      `?action=SUBMISSION_UPDATED&targetId=${submissionId}`,
    ).expect(200);
    expect(res.body.items[0]).toMatchObject({
      actorId: temp.user.id,
      actorName: null,
    });
  });
});
