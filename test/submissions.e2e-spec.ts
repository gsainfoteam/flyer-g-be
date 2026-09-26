import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  assets,
  submissions,
  targetGroups,
  type SubmissionStatus,
} from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import { MemoryStorage } from './helpers/memory-storage.js';
import {
  createReadyAsset,
  createTestUser,
  type TestUser,
  uniqueSlug,
} from './helpers/test-user.js';

const HOUR = 3600_000;
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('게시 신청 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let owner: TestUser;
  let other: TestUser;
  let reviewer: TestUser;
  let assetId: string;
  const groupId = uniqueSlug('grp');
  const hiddenGroupId = uniqueSlug('grp');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new MemoryStorage())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    await db.insert(targetGroups).values([
      { id: groupId, name: 'E2E 그룹' },
      { id: hiddenGroupId, name: 'E2E 숨김', isActive: false },
    ]);
    owner = await createTestUser(app);
    other = await createTestUser(app);
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    assetId = await createReadyAsset(app, owner.user.id);
  });

  afterAll(async () => {
    await owner.remove();
    await other.remove();
    await reviewer.remove();
    await db
      .delete(targetGroups)
      .where(inArray(targetGroups.id, [groupId, hiddenGroupId]));
    await app.close();
  });

  const noticeUrl = () =>
    `https://ziggle.gistory.me/notice/${randomInt(1_000_000, 9_999_999)}`;

  const validBody = (overrides: object = {}) => ({
    title: '  겨울 정기 공연 〈한밤의 물리학〉  ',
    categoryId: 'performance',
    assetId,
    detailUrl: noticeUrl(),
    startAt: fromNow(48 * HOUR),
    endAt: fromNow(9 * 24 * HOUR),
    targetGroupIds: [groupId],
    organizerName: '공연동아리 페이드인',
    subtitle: '12월 셋째 주 금요일 저녁',
    location: '대강당',
    ...overrides,
  });

  const create = (body: object, user = owner, key = randomUUID()) =>
    request(app.getHttpServer())
      .post('/signage/submissions')
      .set('Authorization', user.authHeader)
      .set('Idempotency-Key', key)
      .send(body);

  const get = (path: string, user = owner) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', user.authHeader);

  const patch = (id: string, body: object, user = owner) =>
    request(app.getHttpServer())
      .patch(`/signage/submissions/${id}`)
      .set('Authorization', user.authHeader)
      .send(body);

  const action = (
    id: string,
    name: 'submit' | 'cancel',
    version: number,
    user = owner,
  ) =>
    request(app.getHttpServer())
      .post(`/signage/submissions/${id}/${name}`)
      .set('Authorization', user.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send({ version });

  async function setStatus(
    id: string,
    status: SubmissionStatus,
    period?: { startAt: Date; endAt: Date },
  ) {
    await db
      .update(submissions)
      .set({ status, ...period })
      .where(eq(submissions.id, id));
  }

  describe('생성', () => {
    it('바로 검토 대기로 만들고 표시용 값을 해소해 준다', async () => {
      const body = validBody();
      const res = await create(body).expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        ziggleNoticeId: body.detailUrl.split('/').pop(),
        requesterId: owner.user.id,
        requesterName: 'E2E 사용자',
        type: 'POSTER',
        title: '겨울 정기 공연 〈한밤의 물리학〉',
        categoryId: 'performance',
        categoryName: '공연',
        assetId,
        posterUrl: `https://cdn.test/assets/${assetId}/preview.webp`,
        posterThumbUrl: `https://cdn.test/assets/${assetId}/thumb.webp`,
        detailUrl: body.detailUrl,
        startAt: body.startAt,
        endAt: body.endAt,
        status: 'PENDING_REVIEW',
        priority: 0,
        targetGroupIds: [groupId],
        organizerName: '공연동아리 페이드인',
        subtitle: '12월 셋째 주 금요일 저녁',
        location: '대강당',
        description: null,
        version: 1,
      });
      expect(res.body.submittedAt).toBe(res.body.createdAt);
      expect(res.body.serverTime).toEqual(expect.any(String));
    });

    it('같은 Idempotency-Key로 다시 보내면 하나만 만든다', async () => {
      const key = randomUUID();
      const body = validBody();
      const first = await create(body, owner, key).expect(201);
      const retry = await create(body, owner, key).expect(201);

      expect(retry.body.id).toBe(first.body.id);
      expect(retry.headers['idempotent-replayed']).toBe('true');
    });

    it('같은 공지로 다시 신청하면 409 ALREADY_SUBMITTED', async () => {
      const detailUrl = noticeUrl();
      await create(validBody({ detailUrl })).expect(201);

      // 다른 사용자라도 같은 공지면 막힌다.
      const othersAsset = await createReadyAsset(app, other.user.id);
      const res = await create(
        validBody({ detailUrl, assetId: othersAsset }),
        other,
      ).expect(409);
      expect(res.body).toMatchObject({
        code: 'ALREADY_SUBMITTED',
        fields: { detailUrl: '이 공지로 이미 신청한 게시물이 있습니다.' },
      });
    });

    it('같은 공지로 동시에 신청해도 하나만 통과한다', async () => {
      const detailUrl = noticeUrl();
      const results = await Promise.all([
        create(validBody({ detailUrl })),
        create(validBody({ detailUrl })),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    });

    it('취소한 공지는 다시 신청할 수 있다', async () => {
      const detailUrl = noticeUrl();
      const first = await create(validBody({ detailUrl })).expect(201);
      await action(first.body.id, 'cancel', 1).expect(200);

      await create(validBody({ detailUrl })).expect(201);
    });

    it('상세 링크 없이도 신청할 수 있다', async () => {
      const res = await create(validBody({ detailUrl: undefined })).expect(201);
      expect(res.body).toMatchObject({ detailUrl: null, ziggleNoticeId: null });
    });

    it('검증 실패는 필드별 문구로 한 번에 준다', async () => {
      const res = await create(
        validBody({
          title: '   ',
          categoryId: 'nope',
          detailUrl: 'http://ziggle.gistory.me/notice/1',
          startAt: fromNow(1 * HOUR),
          endAt: fromNow(200 * 24 * HOUR),
          targetGroupIds: [hiddenGroupId],
        }),
      ).expect(422);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      // DTO 검증(제목)이 먼저 걸리면 나머지는 서비스 검증까지 가지 않는다.
      expect(res.body.fields).toEqual({ title: '제목을 입력하세요.' });

      const rest = await create(
        validBody({
          categoryId: 'nope',
          detailUrl: 'http://ziggle.gistory.me/notice/1',
          startAt: fromNow(1 * HOUR),
          endAt: fromNow(200 * 24 * HOUR),
          targetGroupIds: [hiddenGroupId],
        }),
      ).expect(422);
      expect(rest.body.fields).toEqual({
        categoryId: '선택할 수 없는 카테고리입니다.',
        detailUrl: 'https:// 로 시작하는 주소만 쓸 수 있습니다.',
        startAt: '게시 시작은 신청 시각으로부터 24시간 이후여야 합니다.',
        endAt: '게시 기간은 최대 3개월입니다.',
        targetGroupIds: `선택할 수 없는 대상 위치가 있습니다: ${hiddenGroupId}`,
      });
    });

    it('offset 없는 시각은 거절한다', async () => {
      const res = await create(
        validBody({ startAt: '2026-12-01T09:00:00' }),
      ).expect(422);
      expect(res.body.fields).toHaveProperty('startAt');
    });

    it('남의 asset이나 업로드가 끝나지 않은 asset은 쓸 수 없다', async () => {
      const othersAsset = await createReadyAsset(app, other.user.id);
      const notMine = await create(validBody({ assetId: othersAsset })).expect(
        422,
      );
      expect(notMine.body.fields).toEqual({
        assetId: '포스터를 다시 올려주세요.',
      });

      const [pending] = await db
        .insert(assets)
        .values({
          ownerId: owner.user.id,
          fileName: 'p.jpg',
          declaredMimeType: 'image/jpeg',
          declaredSizeBytes: 1,
          uploadExpiresAt: new Date(),
        })
        .returning({ id: assets.id });
      const notReady = await create(validBody({ assetId: pending.id })).expect(
        422,
      );
      expect(notReady.body.fields).toEqual({
        assetId: '포스터 업로드가 끝나지 않았습니다.',
      });
    });

    it('Idempotency-Key가 없으면 400', async () => {
      await request(app.getHttpServer())
        .post('/signage/submissions')
        .set('Authorization', owner.authHeader)
        .send(validBody())
        .expect(400);
    });
  });

  describe('목록과 상세', () => {
    let lister: TestUser;
    let listerAsset: string;
    const ids: string[] = [];

    beforeAll(async () => {
      lister = await createTestUser(app);
      listerAsset = await createReadyAsset(app, lister.user.id);
      for (let i = 0; i < 3; i += 1) {
        const res = await create(
          validBody({ assetId: listerAsset, title: `목록 ${i}` }),
          lister,
        ).expect(201);
        ids.push(res.body.id);
      }
      await setStatus(ids[0], 'ARCHIVED');
      await setStatus(ids[1], 'APPROVED');
    });

    afterAll(async () => {
      await lister.remove();
    });

    it('기본은 내 신청, 최신순, ARCHIVED 제외', async () => {
      const res = await get('/signage/submissions', lister).expect(200);

      expect(res.body.items.map((s: { id: string }) => s.id)).toEqual([
        ids[2],
        ids[1],
      ]);
      expect(res.body).toMatchObject({ totalCount: 2, nextCursor: null });
      expect(res.body.serverTime).toEqual(expect.any(String));
    });

    it('상태 복수 필터와 ARCHIVED 명시 조회', async () => {
      const approved = await get(
        '/signage/submissions?statuses=APPROVED,SCHEDULED',
        lister,
      ).expect(200);
      expect(approved.body.items.map((s: { id: string }) => s.id)).toEqual([
        ids[1],
      ]);

      const archived = await get(
        '/signage/submissions?statuses=ARCHIVED',
        lister,
      ).expect(200);
      expect(archived.body.totalCount).toBe(1);
    });

    it('cursor로 다음 페이지를 이어 받는다', async () => {
      const first = await get(
        '/signage/submissions?statuses=PENDING_REVIEW,APPROVED,ARCHIVED&limit=2&cursor=',
        lister,
      ).expect(200);
      expect(first.body.items).toHaveLength(2);
      expect(first.body.totalCount).toBe(3);

      const second = await get(
        `/signage/submissions?statuses=PENDING_REVIEW,APPROVED,ARCHIVED&limit=2&cursor=${first.body.nextCursor}`,
        lister,
      ).expect(200);
      expect(second.body.items.map((s: { id: string }) => s.id)).toEqual([
        ids[0],
      ]);
      expect(second.body.nextCursor).toBeNull();
    });

    it('scope=all은 검토자만', async () => {
      await get('/signage/submissions?scope=all', lister).expect(403);
      const res = await get(
        '/signage/submissions?scope=all&limit=100',
        reviewer,
      ).expect(200);
      expect(res.body.totalCount).toBeGreaterThanOrEqual(2);
    });

    it('알 수 없는 상태 필터는 422', async () => {
      await get('/signage/submissions?statuses=NOPE', lister).expect(422);
    });

    it('상세는 본인과 검토자만, 나머지는 404', async () => {
      await get(`/signage/submissions/${ids[2]}`, lister).expect(200);
      await get(`/signage/submissions/${ids[2]}`, reviewer).expect(200);
      await get(`/signage/submissions/${ids[2]}`, other).expect(404);
      await get('/signage/submissions/not-a-uuid', lister).expect(404);
    });

    it('요약: 상태별 수와 기간 기준 수치', async () => {
      // ids[1]은 APPROVED인데 이미 기간 안 → 게시 중으로 센다
      await setStatus(ids[1], 'APPROVED', {
        startAt: new Date(Date.now() - HOUR),
        endAt: new Date(Date.now() + HOUR),
      });

      const res = await get('/signage/submissions/summary', lister).expect(200);
      expect(res.body).toMatchObject({
        total: 2,
        published: 1,
        scheduled: 0,
        pendingReview: 1,
        ended: 0,
        byStatus: {
          PENDING_REVIEW: 1,
          APPROVED: 1,
          ARCHIVED: 1,
          CANCELED: 0,
        },
      });

      await get('/signage/submissions/summary?scope=all', lister).expect(403);
    });
  });

  describe('수정', () => {
    async function fresh() {
      const res = await create(validBody()).expect(201);
      return res.body as { id: string; version: number };
    }

    it('바뀐 필드만 반영하고 version을 올린다', async () => {
      const { id } = await fresh();
      const res = await patch(id, {
        version: 1,
        title: '겨울 정기 공연',
        subtitle: '',
        targetGroupIds: [],
      }).expect(200);

      expect(res.body).toMatchObject({
        title: '겨울 정기 공연',
        subtitle: null,
        targetGroupIds: [],
        status: 'PENDING_REVIEW',
        version: 2,
      });
    });

    it('같은 값만 보내면 아무것도 바꾸지 않는다', async () => {
      const created = await create(validBody()).expect(201);
      const { id, title, startAt } = created.body;

      const res = await patch(id, { version: 1, title, startAt }).expect(200);
      expect(res.body.version).toBe(1);
    });

    it('version이 최신이 아니면 409', async () => {
      const { id } = await fresh();
      await patch(id, { version: 1, title: '첫 수정' }).expect(200);
      const res = await patch(id, { version: 1, title: '늦은 수정' }).expect(
        409,
      );
      expect(res.body.code).toBe('CONFLICT');
    });

    it('승인된 신청을 고치면 검토 대기로 돌아간다', async () => {
      const { id } = await fresh();
      await setStatus(id, 'SCHEDULED');

      const res = await patch(id, { version: 1, location: '소강당' }).expect(
        200,
      );
      expect(res.body).toMatchObject({
        status: 'PENDING_REVIEW',
        location: '소강당',
        version: 2,
      });
    });

    it('게시가 시작된 신청은 고칠 수 없다', async () => {
      const { id } = await fresh();
      await setStatus(id, 'SCHEDULED', {
        startAt: new Date(Date.now() - HOUR),
        endAt: new Date(Date.now() + HOUR),
      });
      await patch(id, { version: 1, title: '수정' }).expect(409);
    });

    it('남의 신청은 404', async () => {
      const { id } = await fresh();
      await patch(id, { version: 1, title: '수정' }, other).expect(404);
    });

    it('기간을 바꾸면 규칙을 다시 검사한다', async () => {
      const { id } = await fresh();
      const res = await patch(id, {
        version: 1,
        startAt: fromNow(HOUR),
      }).expect(422);
      expect(res.body.fields).toHaveProperty('startAt');
    });
  });

  describe('재제출과 취소', () => {
    it('반려된 신청을 고쳐 다시 검토 요청한다', async () => {
      const created = await create(validBody()).expect(201);
      const { id } = created.body;
      await setStatus(id, 'REJECTED');

      const edited = await patch(id, { version: 1, title: '고친 제목' }).expect(
        200,
      );
      expect(edited.body).toMatchObject({ status: 'REJECTED', version: 2 });

      const res = await action(id, 'submit', 2).expect(200);
      expect(res.body).toMatchObject({ status: 'PENDING_REVIEW', version: 3 });
      expect(new Date(res.body.submittedAt).getTime()).toBeGreaterThan(
        new Date(created.body.submittedAt).getTime(),
      );
    });

    it('검토 대기 중인 신청은 다시 제출할 수 없다', async () => {
      const created = await create(validBody()).expect(201);
      await action(created.body.id, 'submit', 1).expect(409);
    });

    it('게시 시작 전 승인 건은 취소할 수 있고, 시작 후에는 409', async () => {
      const a = await create(validBody()).expect(201);
      await setStatus(a.body.id, 'APPROVED');
      const canceled = await action(a.body.id, 'cancel', 1).expect(200);
      expect(canceled.body).toMatchObject({ status: 'CANCELED', version: 2 });

      const b = await create(validBody()).expect(201);
      await setStatus(b.body.id, 'PUBLISHED', {
        startAt: new Date(Date.now() - HOUR),
        endAt: new Date(Date.now() + HOUR),
      });
      await action(b.body.id, 'cancel', 1).expect(409);
    });

    it('취소는 version을 확인한다', async () => {
      const created = await create(validBody()).expect(201);
      await action(created.body.id, 'cancel', 5).expect(409);
    });
  });
});
