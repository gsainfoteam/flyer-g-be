import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { auditLogs, users } from '../src/db/schema.js';
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
      .where(inArray(auditLogs.targetId, [submissionId, othersSubmissionId]));
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

  it('형식이 틀린 필터는 422', async () => {
    await list(reviewer, '?targetType=USER').expect(422);
    await list(reviewer, '?action=approved').expect(422);
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
