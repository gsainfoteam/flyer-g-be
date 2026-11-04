import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  addSeoulDays,
  seoulDate,
  startOfSeoulDay,
} from '../src/common/time/seoul-time.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { auditLogs, submissions } from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import { MemoryStorage } from './helpers/memory-storage.js';
import { createTestUser, type TestUser } from './helpers/test-user.js';

const DAY = 86_400_000;

describe('소식 제보 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let author: TestUser;
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

    author = await createTestUser(app);
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
  });

  // author도 하루 한도(5건)를 받으므로 테스트마다 author의 신청을 비운다
  beforeEach(async () => {
    await db
      .delete(submissions)
      .where(eq(submissions.requesterId, author.user.id));
  });

  afterAll(async () => {
    await author.remove();
    await reviewer.remove();
    await admin.remove();
    await app.close();
  });

  const server = () => app.getHttpServer();

  const storyBody = (overrides: object = {}) => ({
    type: 'STORY',
    story: {
      tag: 'PRAISE',
      body: '  B동 3층 세탁실 건조기 2번이 고쳐졌어요.\n관리실에 감사드려요!  ',
    },
    ...overrides,
  });

  const create = (body: object = storyBody(), user = author) =>
    request(server())
      .post('/signage/submissions')
      .set('Authorization', user.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const get = (path: string, user: TestUser) =>
    request(server()).get(path).set('Authorization', user.authHeader);

  const review = (
    id: string,
    action: 'approve' | 'reject',
    body: object,
    user = reviewer,
  ) =>
    request(server())
      .post(`/signage/submissions/${id}/${action}`)
      .set('Authorization', user.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  describe('생성', () => {
    it('기간 없이 검토 대기에 들어가고, 제목은 본문 앞 40자다', async () => {
      const res = await create().expect(201);

      expect(res.body).toMatchObject({
        type: 'STORY',
        status: 'PENDING_REVIEW',
        title: 'B동 3층 세탁실 건조기 2번이 고쳐졌어요. 관리실에 감사드려요!',
        startAt: null,
        endAt: null,
        targetGroupIds: [],
        requesterId: author.user.id,
        eventBanner: null,
        story: {
          tag: 'PRAISE',
          body: 'B동 3층 세탁실 건조기 2번이 고쳐졌어요.\n관리실에 감사드려요!',
          storyNumber: null,
        },
      });
    });

    it('기간·대상 위치·포스터 필드는 받지 않는다', async () => {
      const res = await create(
        storyBody({
          startAt: new Date().toISOString(),
          endAt: new Date(Date.now() + DAY).toISOString(),
          targetGroupIds: ['grp_somewhere'],
          detailUrl: 'https://ziggle.gistory.me/notice/1',
        }),
      ).expect(422);
      const message = '이 종류의 신청에는 쓸 수 없는 항목입니다.';
      expect(res.body.fields).toEqual({
        startAt: message,
        endAt: message,
        targetGroupIds: message,
        detailUrl: message,
      });
    });

    it('본문은 10~140자', async () => {
      const short = await create(
        storyBody({ story: { tag: 'NEWS', body: '짧아요' } }),
      ).expect(422);
      expect(short.body.fields).toEqual({
        'story.body': '본문은 10자 이상이어야 합니다.',
      });

      await create(
        storyBody({ story: { tag: 'NEWS', body: '가'.repeat(141) } }),
      ).expect(422);
    });

    it('하루 5건까지', async () => {
      for (let i = 0; i < 5; i += 1) {
        await create().expect(201);
      }
      const res = await create().expect(429);
      expect(res.body).toMatchObject({
        code: 'DAILY_LIMIT_EXCEEDED',
        details: { type: 'STORY', limit: 5 },
      });
    });
  });

  describe('작성자 가림', () => {
    it('검토자에게는 상세·검토 대기열·목록 어디서도 작성자가 null이다', async () => {
      const { body } = await create().expect(201);

      const detail = await get(
        `/signage/submissions/${body.id}`,
        reviewer,
      ).expect(200);
      expect(detail.body).toMatchObject({
        requesterId: null,
        requesterName: null,
      });

      const queue = await get(
        '/signage/reviews?type=STORY&limit=100',
        reviewer,
      ).expect(200);
      const queued = queue.body.items.find(
        (item: { id: string }) => item.id === body.id,
      );
      expect(queued).toMatchObject({ requesterId: null, requesterName: null });

      const all = await get(
        '/signage/submissions?scope=all&type=STORY&limit=100',
        reviewer,
      ).expect(200);
      expect(
        all.body.items.every(
          (item: { requesterId: string | null }) => item.requesterId === null,
        ),
      ).toBe(true);

      const own = await get(`/signage/submissions/${body.id}`, author).expect(
        200,
      );
      expect(own.body.requesterId).toBe(author.user.id);
    });

    it('승인·반려 응답에서도 작성자가 null이다', async () => {
      const { body } = await create().expect(201);
      const approved = await review(body.id, 'approve', {
        revision: 1,
      }).expect(200);
      expect(approved.body.requesterId).toBeNull();
    });

    it('감사 로그에서 작성자가 한 일의 행위자를 가린다', async () => {
      const { body } = await create().expect(201);

      const asReviewer = await get(
        `/signage/audit-logs?targetType=SUBMISSION&targetId=${body.id}`,
        reviewer,
      ).expect(200);
      expect(asReviewer.body.items).toEqual([
        expect.objectContaining({
          action: 'SUBMISSION_CREATED',
          actorType: 'USER',
          actorId: null,
          actorName: null,
        }),
      ]);

      const asAuthor = await get(
        `/signage/audit-logs?targetType=SUBMISSION&targetId=${body.id}`,
        author,
      ).expect(200);
      expect(asAuthor.body.items[0].actorId).toBe(author.user.id);
    });

    it('SUPER_ADMIN만 작성자를 열람하고, 열람은 감사 로그에 남는다', async () => {
      const { body } = await create().expect(201);
      const reveal = (user: TestUser) =>
        request(server())
          .post(`/signage/submissions/${body.id}/reveal-author`)
          .set('Authorization', user.authHeader);

      await reveal(reviewer).expect(403);
      const res = await reveal(admin).expect(200);
      expect(res.body).toEqual({
        requesterId: author.user.id,
        requesterName: author.user.name,
        requesterEmail: author.user.email,
      });

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.targetId, body.id),
            eq(auditLogs.action, 'STORY_AUTHOR_REVEALED'),
          ),
        );
      expect(log).toMatchObject({ actorId: admin.user.id, metadata: null });
    });

    it('작성자를 가리지 않는 종류는 409, 없는 신청은 404', async () => {
      const today = seoulDate(new Date());
      const banner = await create({
        type: 'EVENT_BANNER',
        startAt: startOfSeoulDay(addSeoulDays(today, 1)).toISOString(),
        endAt: startOfSeoulDay(addSeoulDays(today, 2)).toISOString(),
        eventBanner: {
          mode: 'TEMPLATE',
          occasion: 'BIRTHDAY',
          recipient: '지민',
          headline: '지민아, 생일 축하해',
          message: '축하해!',
        },
      }).expect(201);

      await request(server())
        .post(`/signage/submissions/${banner.body.id}/reveal-author`)
        .set('Authorization', admin.authHeader)
        .expect(409);
      await request(server())
        .post(`/signage/submissions/${randomUUID()}/reveal-author`)
        .set('Authorization', admin.authHeader)
        .expect(404);
    });
  });

  describe('검토', () => {
    it('승인하면 번호를 받고 지금부터 2일 동안 게시된다', async () => {
      const first = (await create().expect(201)).body;
      const second = (await create().expect(201)).body;

      const before = Date.now();
      const a = await review(first.id, 'approve', { revision: 1 }).expect(200);
      const b = await review(second.id, 'approve', { revision: 1 }).expect(200);

      expect(a.body.status).toBe('PUBLISHED');
      const startAt = Date.parse(a.body.startAt);
      expect(startAt).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(a.body.endAt) - startAt).toBe(2 * DAY);
      expect(b.body.story.storyNumber).toBe(a.body.story.storyNumber + 1);
    });

    it('반려된 제보는 고치거나 다시 낼 수 없다', async () => {
      const { body } = await create().expect(201);
      await review(body.id, 'reject', {
        revision: 1,
        reasonCode: 'PERSONAL_INFO',
        comment: '특정인을 알아볼 수 있습니다.',
      }).expect(200);

      const edit = await request(server())
        .patch(`/signage/submissions/${body.id}`)
        .set('Authorization', author.authHeader)
        .send({
          version: 2,
          story: { tag: 'NEWS', body: '고쳐서 다시 냅니다.' },
        })
        .expect(409);
      expect(edit.body.code).toBe('NOT_RESUBMITTABLE');

      const resubmit = await request(server())
        .post(`/signage/submissions/${body.id}/submit`)
        .set('Authorization', author.authHeader)
        .set('Idempotency-Key', randomUUID())
        .send({ version: 2 })
        .expect(409);
      expect(resubmit.body.code).toBe('NOT_RESUBMITTABLE');

      const detail = await get(
        `/signage/submissions/${body.id}`,
        author,
      ).expect(200);
      expect(detail.body.story.storyNumber).toBeNull();
    });

    it('검토 대기 중에는 고치고 취소할 수 있다', async () => {
      const { body } = await create().expect(201);
      const edited = await request(server())
        .patch(`/signage/submissions/${body.id}`)
        .set('Authorization', author.authHeader)
        .send({
          version: 1,
          story: { tag: 'NEWS', body: '내용을 고쳤습니다.' },
        })
        .expect(200);
      expect(edited.body).toMatchObject({
        version: 2,
        title: '내용을 고쳤습니다.',
        story: { tag: 'NEWS' },
      });

      await request(server())
        .post(`/signage/submissions/${body.id}/cancel`)
        .set('Authorization', author.authHeader)
        .set('Idempotency-Key', randomUUID())
        .send({ version: 2 })
        .expect(200);
    });
  });

  describe('최근 소식', () => {
    it('게시 중인 제보만 최근 승인 순으로, 작성자 없이 준다', async () => {
      const pending = (await create().expect(201)).body;
      const older = (await create().expect(201)).body;
      const newer = (await create().expect(201)).body;
      await review(older.id, 'approve', { revision: 1 }).expect(200);
      await review(newer.id, 'approve', { revision: 1 }).expect(200);

      const res = await get('/signage/stories/recent?limit=10', author).expect(
        200,
      );
      const numbers = res.body.items.map(
        (item: { storyNumber: number }) => item.storyNumber,
      );
      const [olderRow, newerRow] = await Promise.all(
        [older.id, newer.id].map((id) =>
          get(`/signage/submissions/${id}`, author).then(
            (r) => r.body.story.storyNumber as number,
          ),
        ),
      );
      expect(numbers.indexOf(newerRow)).toBeLessThan(numbers.indexOf(olderRow));
      expect(numbers.indexOf(olderRow)).toBeGreaterThanOrEqual(0);
      expect(Object.keys(res.body.items[0]).sort()).toEqual([
        'body',
        'startAt',
        'storyNumber',
        'tag',
      ]);
      expect(JSON.stringify(res.body)).not.toContain(pending.id);
    });

    it('limit은 1~10', async () => {
      await get('/signage/stories/recent?limit=11', author).expect(422);
      await get('/signage/stories/recent?limit=0', author).expect(422);
      await request(server()).get('/signage/stories/recent').expect(401);
    });
  });
});
