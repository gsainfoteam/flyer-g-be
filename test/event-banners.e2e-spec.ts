import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  addSeoulDays,
  seoulDate,
  startOfSeoulDay,
} from '../src/common/time/seoul-time.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  auditLogs,
  devices,
  reviews,
  submissionEventBanners,
  submissions,
  targetGroups,
} from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import { MemoryStorage } from './helpers/memory-storage.js';
import {
  createReadyAsset,
  createTestGroup,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

/** 서울 오늘 + n일의 00:00 */
const seoulMidnight = (days: number) =>
  startOfSeoulDay(addSeoulDays(seoulDate(new Date()), days)).toISOString();

describe('이벤트 배너 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let owner: TestUser;
  let reviewer: TestUser;
  let admin: TestUser;
  let imageId: string;
  let photoId: string;
  let videoId: string;
  const deviceIds: string[] = [];
  let groupId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new MemoryStorage())
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);

    owner = await createTestUser(app);
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
    imageId = await createReadyAsset(app, owner.user.id);
    photoId = await createReadyAsset(app, owner.user.id);
    videoId = await createReadyAsset(app, owner.user.id, { video: true });
  });

  // owner도 하루 한도(3건)를 받으므로 테스트마다 owner의 신청을 비운다
  beforeEach(async () => {
    await db
      .delete(submissions)
      .where(eq(submissions.requesterId, owner.user.id));
  });

  afterAll(async () => {
    await owner.remove();
    await reviewer.remove();
    await db.delete(auditLogs).where(inArray(auditLogs.targetId, deviceIds));
    if (deviceIds.length > 0) {
      await db.delete(devices).where(inArray(devices.id, deviceIds));
    }
    if (groupId) {
      await db.delete(targetGroups).where(eq(targetGroups.id, groupId));
    }
    await admin.remove();
    await app.close();
  });

  const server = () => app.getHttpServer();

  const template = (overrides: object = {}) => ({
    mode: 'TEMPLATE',
    occasion: 'BIRTHDAY',
    recipient: ' 지민 ',
    headline: ' 지민아, 생일 축하해 ',
    message: '스물한 살 생일 축하해!',
    sender: '3층 친구들',
    ...overrides,
  });

  const banner = (
    eventBanner: object = template(),
    overrides: object = {},
  ) => ({
    type: 'EVENT_BANNER',
    startAt: seoulMidnight(1),
    endAt: seoulMidnight(2),
    eventBanner,
    ...overrides,
  });

  const create = (body: object, user = owner) =>
    request(server())
      .post('/signage/submissions')
      .set('Authorization', user.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const patch = (id: string, body: object, user = owner) =>
    request(server())
      .patch(`/signage/submissions/${id}`)
      .set('Authorization', user.authHeader)
      .send(body);

  const approve = (id: string, revision: number) =>
    request(server())
      .post(`/signage/submissions/${id}/approve`)
      .set('Authorization', reviewer.authHeader)
      .set('Idempotency-Key', randomUUID())
      .send({ revision });

  describe('생성', () => {
    it('TEMPLATE: 제목을 서버가 만들고 포스터 필드는 null이다', async () => {
      const res = await create(banner()).expect(201);

      expect(res.body).toMatchObject({
        type: 'EVENT_BANNER',
        status: 'PENDING_REVIEW',
        title: '생일 · 지민에게',
        categoryId: null,
        categoryName: null,
        assetId: null,
        posterUrl: null,
        posterKind: null,
        posterWidth: null,
        detailUrl: null,
        organizerName: null,
        targetGroupIds: [],
        eventBanner: {
          mode: 'TEMPLATE',
          occasion: 'BIRTHDAY',
          recipient: '지민',
          headline: '지민아, 생일 축하해',
          message: '스물한 살 생일 축하해!',
          sender: '3층 친구들',
          photoAssetId: null,
          photoUrl: null,
          photoConsent: false,
          assetId: null,
          assetUrl: null,
        },
      });
    });

    it('TEMPLATE의 사진과 IMAGE의 이미지는 미리보기 주소와 함께 온다', async () => {
      const withPhoto = await create(
        banner(template({ photoAssetId: photoId, photoConsent: true })),
      ).expect(201);
      expect(withPhoto.body.eventBanner).toMatchObject({
        photoAssetId: photoId,
        photoUrl: expect.stringContaining(`${photoId}/preview`),
        photoConsent: true,
        assetId: null,
      });

      const image = await create(
        banner({ mode: 'IMAGE', recipient: '수민', assetId: imageId }),
      ).expect(201);
      expect(image.body).toMatchObject({
        title: '이벤트 배너 · 수민에게',
        assetId: null,
        eventBanner: {
          mode: 'IMAGE',
          occasion: null,
          assetId: imageId,
          assetUrl: expect.stringContaining(`${imageId}/preview`),
          photoAssetId: null,
        },
      });
    });

    it('오늘 자정에 시작하는 당일 신청을 받는다', async () => {
      await create(
        banner(template(), {
          startAt: seoulMidnight(0),
          endAt: seoulMidnight(1),
        }),
      ).expect(201);
    });

    it('형식별 규칙과 기간 규칙을 한 번에 알려 준다', async () => {
      const res = await create(
        banner(template({ occasion: null, photoAssetId: photoId }), {
          startAt: seoulMidnight(1),
          endAt: seoulMidnight(5),
        }),
      ).expect(422);
      expect(res.body.fields).toEqual({
        'eventBanner.occasion': '어떤 소식인지 고르세요.',
        'eventBanner.photoConsent':
          '사진 속 사람의 동의를 받았는지 확인해 주세요.',
        endAt: '이벤트 배너는 최대 3일까지 걸 수 있습니다.',
      });
    });

    it('영상은 쓸 수 없다', async () => {
      const res = await create(
        banner({ mode: 'IMAGE', recipient: '지민', assetId: videoId }),
      ).expect(422);
      expect(res.body.fields).toEqual({
        'eventBanner.assetId': '영상은 쓸 수 없습니다. 이미지를 올려주세요.',
      });
    });

    it('내용이 없거나 필드 모양이 틀리면 422', async () => {
      const { eventBanner: _, ...withoutContent } = banner();
      const missing = await create(withoutContent).expect(422);
      expect(missing.body.fields).toEqual({
        eventBanner: '이벤트 배너 내용을 입력하세요.',
      });

      const tooLong = await create(
        banner(template({ recipient: '가'.repeat(21) })),
      ).expect(422);
      expect(tooLong.body.fields).toEqual({
        'eventBanner.recipient': '받는 사람은 20자 이하여야 합니다.',
      });
    });

    it('그 종류가 받지 않는 필드는 422', async () => {
      const posterFields = await create(
        banner(template(), { title: '제목', categoryId: 'performance' }),
      ).expect(422);
      expect(posterFields.body.fields).toEqual({
        title: '이 종류의 신청에는 쓸 수 없는 항목입니다.',
        categoryId: '이 종류의 신청에는 쓸 수 없는 항목입니다.',
      });

      const onPoster = await create({
        title: '포스터',
        categoryId: 'performance',
        assetId: imageId,
        startAt: seoulMidnight(1),
        endAt: seoulMidnight(2),
        eventBanner: template(),
      }).expect(422);
      expect(onPoster.body.fields).toEqual({
        eventBanner: '이 종류의 신청에는 쓸 수 없는 항목입니다.',
      });
    });
  });

  describe('하루 한도', () => {
    it('하루 3건까지. 취소한 것도 센다', async () => {
      const user = await createTestUser(app);
      try {
        const first = await create(banner(), user).expect(201);
        await create(banner(), user).expect(201);
        await request(server())
          .post(`/signage/submissions/${first.body.id}/cancel`)
          .set('Authorization', user.authHeader)
          .set('Idempotency-Key', randomUUID())
          .send({ version: 1 })
          .expect(200);
        await create(banner(), user).expect(201);

        const res = await create(banner(), user).expect(429);
        expect(res.body).toMatchObject({
          code: 'DAILY_LIMIT_EXCEEDED',
          details: { type: 'EVENT_BANNER', limit: 3 },
        });
      } finally {
        await user.remove();
      }
    });

    it('동시에 보내도 한도를 넘지 않는다', async () => {
      const user = await createTestUser(app);
      try {
        const results = await Promise.all(
          Array.from({ length: 5 }, () => create(banner(), user)),
        );
        const statuses = results.map((res) => res.status).sort();
        expect(statuses).toEqual([201, 201, 201, 429, 429]);
      } finally {
        await user.remove();
      }
    });

    it('포스터에는 한도가 없다', async () => {
      const user = await createTestUser(app);
      try {
        const asset = await createReadyAsset(app, user.user.id);
        for (let i = 0; i < 4; i += 1) {
          await create(
            {
              title: `포스터 ${i}`,
              categoryId: 'performance',
              assetId: asset,
              startAt: seoulMidnight(1),
              endAt: seoulMidnight(2),
            },
            user,
          ).expect(201);
        }
      } finally {
        await user.remove();
      }
    });
  });

  describe('수정', () => {
    it('eventBanner를 통째로 바꾸고 제목도 다시 만든다', async () => {
      const created = await create(banner()).expect(201);
      const res = await patch(created.body.id, {
        version: 1,
        eventBanner: template({
          occasion: 'AWARD',
          recipient: '수민',
          sender: null,
        }),
      }).expect(200);

      expect(res.body).toMatchObject({
        version: 2,
        title: '수상 · 수민에게',
        eventBanner: { occasion: 'AWARD', recipient: '수민', sender: null },
      });
    });

    it('같은 내용을 다시 보내면 바뀌지 않는다', async () => {
      const created = await create(banner()).expect(201);
      const res = await patch(created.body.id, {
        version: 1,
        eventBanner: template(),
      }).expect(200);
      expect(res.body.version).toBe(1);
    });

    it('승인된 배너를 고치면 다시 검토 대기다. 감사 로그에 eventBanner가 남는다', async () => {
      const created = await create(banner()).expect(201);
      await approve(created.body.id, 1).expect(200);

      const res = await patch(created.body.id, {
        version: 2,
        eventBanner: template({ message: '다시 축하해!' }),
      }).expect(200);
      expect(res.body.status).toBe('PENDING_REVIEW');

      const logs = await db
        .select({ metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, created.body.id));
      expect(logs.map((l) => l.metadata)).toContainEqual(
        expect.objectContaining({ changedFields: ['eventBanner'] }),
      );
    });

    it('기간만 바꿀 수 있고 규칙을 다시 검사한다', async () => {
      const created = await create(banner()).expect(201);
      await patch(created.body.id, {
        version: 1,
        endAt: seoulMidnight(3),
      }).expect(200);

      const res = await patch(created.body.id, {
        version: 2,
        endAt: new Date(Date.parse(seoulMidnight(3)) + 3600_000).toISOString(),
      }).expect(422);
      expect(res.body.fields).toEqual({
        endAt: '종료는 서울 기준 자정(00:00)이어야 합니다.',
      });
    });

    it('포스터 필드는 보낼 수 없다', async () => {
      const created = await create(banner()).expect(201);
      const res = await patch(created.body.id, {
        version: 1,
        title: '제목',
      }).expect(422);
      expect(res.body.fields).toEqual({
        title: '이 종류의 신청에는 쓸 수 없는 항목입니다.',
      });
    });
  });

  describe('검토와 편성', () => {
    it('사진 없는 템플릿은 checksum 없이 승인된다', async () => {
      const created = await create(
        banner(template(), {
          startAt: seoulMidnight(0),
          endAt: seoulMidnight(1),
        }),
      ).expect(201);
      const res = await approve(created.body.id, 1).expect(200);
      expect(res.body.status).toBe('PUBLISHED');

      const [review] = await db
        .select({ assetChecksum: reviews.assetChecksum })
        .from(reviews)
        .where(eq(reviews.submissionId, created.body.id));
      expect(review.assetChecksum).toBeNull();
    });

    it('이미지 배너는 이미지의 checksum을 고정한다', async () => {
      const created = await create(
        banner({ mode: 'IMAGE', recipient: '지민', assetId: imageId }),
      ).expect(201);
      await approve(created.body.id, 1).expect(200);

      const [review] = await db
        .select({ assetChecksum: reviews.assetChecksum })
        .from(reviews)
        .where(eq(reviews.submissionId, created.body.id));
      expect(review.assetChecksum).toBe(`sha256:${'0'.repeat(64)}`);
    });

    it('검토 대기열·목록의 종류 필터와 요약', async () => {
      const created = await create(banner()).expect(201);

      const queue = await request(server())
        .get('/signage/reviews?type=EVENT_BANNER&limit=100')
        .set('Authorization', reviewer.authHeader)
        .expect(200);
      const types = queue.body.items.map((s: { type: string }) => s.type);
      expect(new Set(types)).toEqual(new Set(['EVENT_BANNER']));
      expect(queue.body.items.map((s: { id: string }) => s.id)).toContain(
        created.body.id,
      );

      const summary = await request(server())
        .get('/signage/submissions/summary')
        .set('Authorization', owner.authHeader)
        .expect(200);
      expect(summary.body.byType.EVENT_BANNER.pendingReview).toBeGreaterThan(0);
      expect(summary.body.byType.POSTER).toEqual({
        pendingReview: 0,
        oldestSubmittedAt: null,
      });
    });

    it('편성 v1에는 나오지 않는다', async () => {
      groupId = await createTestGroup(app);
      const device = await request(server())
        .post('/signage/devices')
        .set('Authorization', admin.authHeader)
        .send({ name: 'E2E 배너 TV', groupIds: [groupId] })
        .expect(201);
      deviceIds.push(device.body.id);

      const created = await create(
        banner(template(), {
          startAt: seoulMidnight(0),
          endAt: seoulMidnight(1),
        }),
      ).expect(201);
      await approve(created.body.id, 1).expect(200);

      const playlist = await request(server())
        .get(`/signage/devices/${device.body.id}/playlist`)
        .set('X-Device-Token', device.body.token)
        .expect(200);
      expect(
        playlist.body.items.map(
          (item: { submissionId: string }) => item.submissionId,
        ),
      ).not.toContain(created.body.id);
    });
  });

  it('신청을 지우면 상세도 같이 지워진다', async () => {
    const user = await createTestUser(app);
    const created = await create(banner(), user).expect(201);
    await user.remove();
    const rows = await db
      .select()
      .from(submissionEventBanners)
      .where(eq(submissionEventBanners.submissionId, created.body.id));
    expect(rows).toEqual([]);
  });
});
