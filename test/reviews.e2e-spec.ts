import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { asc, eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  auditLogs,
  reviews,
  submissions,
  type SubmissionStatus,
} from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import { MemoryStorage } from './helpers/memory-storage.js';
import {
  createReadyAsset,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

const HOUR = 3600_000;
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('검토와 승인 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let requester: TestUser;
  let stranger: TestUser;
  let reviewer: TestUser;
  let reviewer2: TestUser;
  let superAdmin: TestUser;
  let assetId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new MemoryStorage())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    requester = await createTestUser(app);
    stranger = await createTestUser(app);
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    reviewer2 = await createTestUser(app, { roles: ['REVIEWER'] });
    superAdmin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
    assetId = await createReadyAsset(app, requester.user.id);
  });

  afterAll(async () => {
    // 신청을 먼저 지워야(검토 이력도 함께 지워짐) 검토자를 지울 수 있다.
    await requester.remove();
    for (const user of [stranger, reviewer, reviewer2, superAdmin]) {
      await user.remove();
    }
    await app.close();
  });

  const server = () => app.getHttpServer();

  async function submission(overrides: object = {}) {
    const res = await request(server())
      .post('/signage/submissions')
      .set('Authorization', requester.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send({
        title: '검토 대상',
        categoryId: 'event',
        assetId,
        startAt: fromNow(48 * HOUR),
        endAt: fromNow(7 * 24 * HOUR),
        ...overrides,
      })
      .expect(201);
    return res.body as { id: string; version: number; submittedAt: string };
  }

  async function setRow(
    id: string,
    values: { status?: SubmissionStatus; startAt?: Date; endAt?: Date },
  ) {
    await db.update(submissions).set(values).where(eq(submissions.id, id));
  }

  const approve = (id: string, revision: number, user = reviewer) =>
    request(server())
      .post(`/signage/submissions/${id}/approve`)
      .set('Authorization', user.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send({ revision });

  const reject = (id: string, body: object, user = reviewer) =>
    request(server())
      .post(`/signage/submissions/${id}/reject`)
      .set('Authorization', user.authHeader)
      .send(body);

  const suspend = (id: string, body: object, user = reviewer) =>
    request(server())
      .post(`/signage/submissions/${id}/suspend`)
      .set('Authorization', user.authHeader)
      .send(body);

  const get = (path: string, user: TestUser) =>
    request(server()).get(path).set('Authorization', user.authHeader);

  describe('검토 대기열', () => {
    it('검토자만 볼 수 있다', async () => {
      await get('/signage/reviews', requester).expect(403);
    });

    it('오래 기다린 순, 카테고리 필터, 기본 limit 20', async () => {
      const older = await submission({ categoryId: 'club' });
      const newer = await submission({ categoryId: 'club' });
      // 먼저 제출한 건이 더 오래 기다렸다
      await db
        .update(submissions)
        .set({ submittedAt: new Date(Date.now() - 10 * 24 * HOUR) })
        .where(eq(submissions.id, older.id));

      const res = await get(
        '/signage/reviews?categoryId=club&limit=',
        reviewer,
      ).expect(200);
      const ids = res.body.items.map((s: { id: string }) => s.id);

      expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id));
      expect(
        res.body.items.every(
          (s: { status: string; categoryId: string }) =>
            s.status === 'PENDING_REVIEW' && s.categoryId === 'club',
        ),
      ).toBe(true);
      expect(res.body.items[0]).toHaveProperty('requesterName', 'E2E 사용자');
      expect(res.body.items.length).toBeLessThanOrEqual(20);
    });

    it('cursor로 이어 받으면 겹치지 않는다', async () => {
      await submission({ categoryId: 'department' });
      await submission({ categoryId: 'department' });
      const first = await get(
        '/signage/reviews?categoryId=department&limit=1',
        reviewer,
      ).expect(200);
      const second = await get(
        `/signage/reviews?categoryId=department&limit=1&cursor=${first.body.nextCursor}`,
        reviewer,
      ).expect(200);

      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    });
  });

  describe('승인', () => {
    it('시작 전이면 SCHEDULED, version이 오르고 checksum이 고정된다', async () => {
      const { id } = await submission();
      const res = await approve(id, 1).expect(200);

      expect(res.body).toMatchObject({ status: 'SCHEDULED', version: 2 });
      const [review] = await db
        .select()
        .from(reviews)
        .where(eq(reviews.submissionId, id));
      expect(review).toMatchObject({
        decision: 'APPROVED',
        revision: 1,
        reviewerId: reviewer.user.id,
        assetChecksum: `sha256:${'0'.repeat(64)}`,
      });
    });

    it('시작 시각이 지났으면 바로 PUBLISHED', async () => {
      const { id } = await submission();
      await setRow(id, { startAt: new Date(Date.now() - HOUR) });
      const res = await approve(id, 1).expect(200);
      expect(res.body.status).toBe('PUBLISHED');
    });

    it('SUPER_ADMIN도 승인할 수 있다', async () => {
      const { id } = await submission();
      await approve(id, 1, superAdmin).expect(200);
    });

    it('두 검토자가 동시에 승인하면 한 명만 성공한다', async () => {
      const { id } = await submission();
      const results = await Promise.all([
        approve(id, 1, reviewer),
        approve(id, 1, reviewer2),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const rows = await db
        .select()
        .from(reviews)
        .where(eq(reviews.submissionId, id));
      expect(rows).toHaveLength(1);
    });

    it('이미 처리했거나 revision이 다르면 409', async () => {
      const { id } = await submission();
      await approve(id, 1).expect(200);
      await approve(id, 1).expect(409);
      await approve(id, 2).expect(409);
    });

    it('기간이 끝난 신청은 승인할 수 없다', async () => {
      const { id } = await submission();
      await setRow(id, {
        startAt: new Date(Date.now() - 48 * HOUR),
        endAt: new Date(Date.now() - HOUR),
      });
      await approve(id, 1).expect(409);
    });

    it('검토자가 아니면 403, 없는 신청은 404', async () => {
      const { id } = await submission();
      await approve(id, 1, requester).expect(403);
      await approve(randomUUID(), 1).expect(404);
    });
  });

  describe('반려', () => {
    it('사유 코드와 의견을 남기고 REJECTED', async () => {
      const { id } = await submission();
      const res = await reject(id, {
        revision: 1,
        reasonCode: 'LOW_RESOLUTION',
        comment: '  1080px 이상으로 다시 올려주세요.  ',
      }).expect(200);
      expect(res.body).toMatchObject({ status: 'REJECTED', version: 2 });
    });

    it('의견이 비었거나 사유 코드가 틀리면 422', async () => {
      const { id } = await submission();
      const res = await reject(id, {
        revision: 1,
        reasonCode: 'NOPE',
        comment: '   ',
      }).expect(422);
      expect(res.body.fields).toEqual({
        reasonCode: '반려 사유를 선택하세요.',
        comment: '반려 의견을 입력하세요.',
      });
    });
  });

  describe('게시 중단', () => {
    it('승인된 게시를 내린다', async () => {
      const { id } = await submission();
      await approve(id, 1).expect(200);
      const res = await suspend(id, {
        reason: '행사가 취소되었습니다.',
      }).expect(200);
      expect(res.body).toMatchObject({ status: 'SUSPENDED', version: 3 });
    });

    it('검토 대기 중이거나 끝난 게시는 중단할 수 없다', async () => {
      const pending = await submission();
      await suspend(pending.id, { reason: '사유' }).expect(409);

      const ended = await submission();
      await setRow(ended.id, {
        status: 'PUBLISHED',
        startAt: new Date(Date.now() - 48 * HOUR),
        endAt: new Date(Date.now() - HOUR),
      });
      await suspend(ended.id, { reason: '사유' }).expect(409);
    });

    it('사유가 비면 422', async () => {
      const { id } = await submission();
      await approve(id, 1).expect(200);
      const res = await suspend(id, { reason: '' }).expect(422);
      expect(res.body.fields).toEqual({ reason: '중단 사유를 입력하세요.' });
    });
  });

  describe('전체 흐름과 기록', () => {
    it('반려 → 수정 → 재제출 → 승인 → 중단이 이력과 감사 로그에 남는다', async () => {
      const { id } = await submission();

      await reject(id, {
        revision: 1,
        reasonCode: 'INFO_MISMATCH',
        comment: '장소를 확인해 주세요.',
      }).expect(200);

      await request(server())
        .patch(`/signage/submissions/${id}`)
        .set('Authorization', requester.authHeader)
        .send({ version: 2, location: '대강당' })
        .expect(200);
      await request(server())
        .post(`/signage/submissions/${id}/submit`)
        .set('Authorization', requester.authHeader)
        .set('Idempotency-Key', randomUUID())
        .send({ version: 3 })
        .expect(200);

      const approved = await approve(id, 4).expect(200);
      await suspend(id, { reason: '행사 취소' }).expect(200);

      // 검토 이력: 신청자와 검토자는 보고, 다른 사용자는 404
      const history = await get(
        `/signage/submissions/${id}/reviews`,
        requester,
      ).expect(200);
      expect(history.body).toEqual([
        expect.objectContaining({
          decision: 'REJECTED',
          revision: 1,
          reasonCode: 'INFO_MISMATCH',
          comment: '장소를 확인해 주세요.',
          reviewerId: reviewer.user.id,
          reviewerName: 'E2E 사용자',
        }),
        expect.objectContaining({
          decision: 'APPROVED',
          revision: 4,
          reasonCode: null,
          comment: null,
        }),
        expect.objectContaining({
          decision: 'SUSPENDED',
          revision: 5,
          comment: '행사 취소',
        }),
      ]);
      await get(`/signage/submissions/${id}/reviews`, reviewer).expect(200);
      await get(`/signage/submissions/${id}/reviews`, stranger).expect(404);

      // 감사 로그: 순서대로, 요청 ID와 함께
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.targetId, id))
        .orderBy(asc(auditLogs.createdAt));
      expect(logs.map((log) => log.action)).toEqual([
        'SUBMISSION_CREATED',
        'SUBMISSION_REJECTED',
        'SUBMISSION_UPDATED',
        'SUBMISSION_RESUBMITTED',
        'SUBMISSION_APPROVED',
        'SUBMISSION_SUSPENDED',
      ]);
      const approveLog = logs.find(
        (log) => log.action === 'SUBMISSION_APPROVED',
      );
      expect(approveLog).toMatchObject({
        actorType: 'USER',
        actorId: reviewer.user.id,
        targetType: 'SUBMISSION',
        requestId: approved.headers['x-request-id'],
      });
      expect(
        logs.find((log) => log.action === 'SUBMISSION_UPDATED')?.metadata,
      ).toEqual({
        changedFields: ['location'],
        fromStatus: 'REJECTED',
        toStatus: 'REJECTED',
      });
      expect(
        logs.find((log) => log.action === 'SUBMISSION_SUSPENDED')?.reason,
      ).toBe('행사 취소');
    });
  });
});
