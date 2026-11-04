import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  addSeoulDays,
  seoulDate,
  startOfSeoulDay,
} from '../src/common/time/seoul-time.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { auditLogs, reviews, submissions } from '../src/db/schema.js';
import { SignageChanges } from '../src/realtime/signage-changes.js';
import { StorageService } from '../src/storage/storage.service.js';
import { MemoryStorage } from './helpers/memory-storage.js';
import {
  createReadyAsset,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

describe('작성자의 게시 중단 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let owner: TestUser;
  let stranger: TestUser;
  let reviewer: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new MemoryStorage())
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);
    owner = await createTestUser(app);
    stranger = await createTestUser(app);
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
  });

  beforeEach(async () => {
    await db
      .delete(submissions)
      .where(eq(submissions.requesterId, owner.user.id));
  });

  afterAll(async () => {
    await owner.remove();
    await stranger.remove();
    await reviewer.remove();
    await admin.remove();
    await app.close();
  });

  const server = () => app.getHttpServer();
  const post = (
    id: string,
    action: string,
    user: TestUser,
    body: object,
    key = randomUUID(),
  ) =>
    request(server())
      .post(`/signage/submissions/${id}/${action}`)
      .set('Authorization', user.authHeader)
      .set('Idempotency-Key', key)
      .send(body);
  const get = (path: string, user: TestUser) =>
    request(server()).get(path).set('Authorization', user.authHeader);

  const create = (body: object) =>
    request(server())
      .post('/signage/submissions')
      .set('Authorization', owner.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  describe.each(['STORY', 'EVENT_BANNER'] as const)('%s', (type) => {
    async function submission(approved = true) {
      const today = seoulDate(new Date());
      const { body } = await create(
        type === 'STORY'
          ? {
              type,
              story: { tag: 'NEWS', body: '이번 주 행사가 취소되었습니다.' },
            }
          : {
              type,
              startAt: startOfSeoulDay(addSeoulDays(today, 1)).toISOString(),
              endAt: startOfSeoulDay(addSeoulDays(today, 2)).toISOString(),
              eventBanner: {
                mode: 'TEMPLATE',
                occasion: 'BIRTHDAY',
                recipient: '지민',
                headline: '생일 축하해!',
                message: '생일을 축하해요!',
              },
            },
      ).expect(201);
      if (approved) {
        await post(body.id, 'approve', reviewer, { revision: 1 }).expect(200);
      }
      return body.id as string;
    }

    it.each(['APPROVED', 'SCHEDULED', 'PUBLISHED'] as const)(
      '작성자가 %s 게시를 중단하고 이력·감사 로그·동기화 알림을 남긴다',
      async (status) => {
        const id = await submission();
        await db
          .update(submissions)
          .set({ status })
          .where(eq(submissions.id, id));
        const emit = vi.spyOn(app.get(SignageChanges), 'emit');
        try {
          const res = await post(id, 'suspend', owner, {
            reason: '  행사 취소  ',
          }).expect(200);
          expect(res.body).toMatchObject({
            id,
            type,
            status: 'SUSPENDED',
            version: 3,
            lastDecision: 'SUSPENDED',
            requesterId: owner.user.id,
          });
          expect(emit).toHaveBeenCalledWith({ scope: 'ALL' });
          const history = await get(
            `/signage/submissions/${id}/reviews`,
            owner,
          ).expect(200);
          expect(history.body).toContainEqual(
            expect.objectContaining({
              decision: 'SUSPENDED',
              reviewerId: owner.user.id,
              comment: '행사 취소',
              revision: 2,
            }),
          );
          const logs = await db
            .select()
            .from(auditLogs)
            .where(eq(auditLogs.targetId, id));
          expect(logs).toContainEqual(
            expect.objectContaining({
              action: 'SUBMISSION_SUSPENDED',
              actorId: owner.user.id,
              reason: '행사 취소',
              metadata: { revision: 2, fromStatus: status },
            }),
          );
        } finally {
          emit.mockRestore();
        }
      },
    );

    it('타인의 게시와 없는 게시에는 404이며 상태와 이력을 바꾸지 않는다', async () => {
      const id = await submission();
      await post(id, 'suspend', stranger, { reason: '중단' }).expect(404);
      await post(randomUUID(), 'suspend', owner, { reason: '중단' }).expect(
        404,
      );
      const detail = await get(`/signage/submissions/${id}`, owner).expect(200);
      expect(detail.body.version).toBe(2);
      const history = await db
        .select()
        .from(reviews)
        .where(eq(reviews.submissionId, id));
      expect(history).toHaveLength(1);
    });

    it.each([
      'DRAFT',
      'PENDING_REVIEW',
      'REJECTED',
      'CANCELED',
      'ENDED',
      'ARCHIVED',
      'SUSPENDED',
    ] as const)('%s 상태는 작성자도 중단할 수 없다', async (status) => {
      const id = await submission();
      await db
        .update(submissions)
        .set({ status })
        .where(eq(submissions.id, id));
      await post(id, 'suspend', owner, { reason: '중단' }).expect(409);
    });

    it('기간이 끝났으면 상태 갱신 전이어도 중단할 수 없다', async () => {
      const id = await submission();
      await db
        .update(submissions)
        .set({
          status: 'PUBLISHED',
          startAt: new Date(Date.now() - 7200_000),
          endAt: new Date(Date.now() - 3600_000),
        })
        .where(eq(submissions.id, id));
      await post(id, 'suspend', owner, { reason: '중단' }).expect(409);
    });

    it('사유와 인증·멱등 키가 필요하고 같은 요청의 재시도는 이력을 중복 기록하지 않는다', async () => {
      const id = await submission();
      await request(server())
        .post(`/signage/submissions/${id}/suspend`)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: '중단' })
        .expect(401);
      await request(server())
        .post(`/signage/submissions/${id}/suspend`)
        .set('Authorization', owner.authHeader)
        .send({ reason: '중단' })
        .expect(400);
      for (const reason of ['', '   ', '가'.repeat(1001)]) {
        const res = await post(id, 'suspend', owner, { reason }).expect(422);
        expect(res.body.fields.reason).toBeDefined();
      }
      const key = randomUUID();
      const body = { reason: '행사 취소' };
      const first = await post(id, 'suspend', owner, body, key).expect(200);
      const retry = await post(id, 'suspend', owner, body, key).expect(200);
      expect(retry.body).toEqual(first.body);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      const history = await db
        .select()
        .from(reviews)
        .where(eq(reviews.submissionId, id));
      expect(history).toHaveLength(2);
    });

    it('검토자·운영자는 타인의 게시를 계속 중단할 수 있고 작성자 중단 이력은 익명 정책을 따른다', async () => {
      for (const user of [reviewer, admin]) {
        const id = await submission();
        await post(id, 'suspend', user, { reason: '운영 중단' }).expect(200);
      }
      const id = await submission();
      await post(id, 'suspend', owner, { reason: '직접 중단' }).expect(200);
      for (const user of [reviewer, admin]) {
        const hidden = type === 'STORY';
        const history = await get(
          `/signage/submissions/${id}/reviews`,
          user,
        ).expect(200);
        expect(history.body).toContainEqual(
          expect.objectContaining({
            decision: 'SUSPENDED',
            reviewerId: hidden ? null : owner.user.id,
            reviewerName: hidden ? null : owner.user.name,
          }),
        );
        expect(history.body).toContainEqual(
          expect.objectContaining({
            decision: 'APPROVED',
            reviewerId: reviewer.user.id,
          }),
        );
        const logs = await get(
          `/signage/audit-logs?targetType=SUBMISSION&targetId=${id}`,
          user,
        ).expect(200);
        expect(logs.body.items).toContainEqual(
          expect.objectContaining({
            action: 'SUBMISSION_SUSPENDED',
            actorId: hidden ? null : owner.user.id,
            actorName: hidden ? null : owner.user.name,
          }),
        );
      }
    });

    it('작성자의 승인·반려 권한은 허용하지 않는다', async () => {
      const id = await submission(false);
      await post(id, 'approve', owner, { revision: 1 }).expect(403);
      await post(id, 'reject', owner, {
        revision: 1,
        reasonCode: 'OTHER',
        comment: '반려',
      }).expect(403);
    });
  });

  it('일반 사용자의 포스터 중단 권한은 허용하지 않는다', async () => {
    const assetId = await createReadyAsset(app, owner.user.id);
    const { body } = await create({
      title: '포스터',
      categoryId: 'event',
      assetId,
      startAt: new Date(Date.now() + 3600_000).toISOString(),
      endAt: new Date(Date.now() + 7200_000).toISOString(),
    }).expect(201);
    await post(body.id, 'approve', reviewer, { revision: 1 }).expect(200);
    await post(body.id, 'suspend', owner, { reason: '중단' }).expect(403);
  });
});
