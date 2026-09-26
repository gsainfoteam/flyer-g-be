import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  assets,
  auditLogs,
  devices,
  submissionTargetGroups,
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
const at = (offsetMs: number) => new Date(Date.now() + offsetMs);

type RegisteredDevice = { id: string; token: string };

describe('편성 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let admin: TestUser;
  let requester: TestUser;
  let assetId: string;
  const group1 = uniqueSlug('grp');
  const group2 = uniqueSlug('grp');
  const deviceIds: string[] = [];
  let inGroup1: RegisteredDevice;
  let inGroup2: RegisteredDevice;
  let noGroup: RegisteredDevice;

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

    await db.insert(targetGroups).values([
      { id: group1, name: 'E2E 편성 그룹 1' },
      { id: group2, name: 'E2E 편성 그룹 2' },
    ]);
    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
    requester = await createTestUser(app);
    assetId = await createReadyAsset(app, requester.user.id);

    inGroup1 = await register([group1], {
      layout: 'SINGLE',
      rotationSeconds: 15,
    });
    inGroup2 = await register([group2]);
    noGroup = await register([]);
  });

  afterAll(async () => {
    await requester.remove();
    await db.delete(auditLogs).where(inArray(auditLogs.targetId, deviceIds));
    await db.delete(devices).where(inArray(devices.id, deviceIds));
    await db
      .delete(targetGroups)
      .where(inArray(targetGroups.id, [group1, group2]));
    await admin.remove();
    await app.close();
  });

  async function register(
    groupIds: string[],
    settings: object = {},
  ): Promise<RegisteredDevice> {
    const res = await request(app.getHttpServer())
      .post('/signage/devices')
      .set('Authorization', admin.authHeader)
      .send({ name: 'E2E 편성 TV', groupIds, ...settings })
      .expect(201);
    deviceIds.push(res.body.id);
    return { id: res.body.id, token: res.body.token };
  }

  /** 상태·기간·대상을 정확히 맞추려고 API를 거치지 않고 넣는다. */
  async function insertSubmission(options: {
    status: SubmissionStatus;
    startAt?: Date;
    endAt?: Date;
    priority?: number;
    targetGroupIds?: string[];
    title?: string;
  }): Promise<string> {
    const now = new Date();
    const [row] = await db
      .insert(submissions)
      .values({
        requesterId: requester.user.id,
        title: options.title ?? `E2E ${options.status}`,
        categoryId: 'performance',
        assetId,
        detailUrl: 'https://ziggle.gistory.me/notice/1',
        startAt: options.startAt ?? at(-HOUR),
        endAt: options.endAt ?? at(HOUR),
        status: options.status,
        priority: options.priority ?? 0,
        organizerName: '공연동아리',
        subtitle: '부제',
        location: '대강당',
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: submissions.id });
    if (options.targetGroupIds?.length) {
      await db.insert(submissionTargetGroups).values(
        options.targetGroupIds.map((targetGroupId) => ({
          submissionId: row.id,
          targetGroupId,
        })),
      );
    }
    return row.id;
  }

  const fetchPlaylist = (device: RegisteredDevice, etag?: string) => {
    const req = request(app.getHttpServer())
      .get(`/signage/devices/${device.id}/playlist`)
      .set('X-Device-Token', device.token);
    return etag ? req.set('If-None-Match', etag) : req;
  };

  /** 다른 테스트가 남긴 데이터와 섞이지 않게 우리가 만든 신청만 본다. */
  async function ourItemIds(device: RegisteredDevice, ids: string[]) {
    const res = await fetchPlaylist(device).expect(200);
    return (res.body.items as { submissionId: string }[])
      .map((item) => item.submissionId)
      .filter((id) => ids.includes(id));
  }

  it('승인됐고 기간 안인 것만, 상태가 늦게 바뀌어도 기간으로 판정한다', async () => {
    const published = await insertSubmission({ status: 'PUBLISHED' });
    const lagging = await insertSubmission({ status: 'SCHEDULED' });
    const approved = await insertSubmission({ status: 'APPROVED' });
    const future = await insertSubmission({
      status: 'SCHEDULED',
      startAt: at(HOUR),
      endAt: at(2 * HOUR),
    });
    const ended = await insertSubmission({
      status: 'PUBLISHED',
      startAt: at(-2 * HOUR),
      endAt: at(-HOUR),
    });
    const excluded = await Promise.all(
      (
        [
          'PENDING_REVIEW',
          'REJECTED',
          'SUSPENDED',
          'CANCELED',
          'ENDED',
        ] as const
      ).map((status) => insertSubmission({ status })),
    );

    const ids = await ourItemIds(noGroup, [
      published,
      lagging,
      approved,
      future,
      ended,
      ...excluded,
    ]);
    expect(ids.sort()).toEqual([published, lagging, approved].sort());
  });

  it('대상 그룹이 있으면 그 그룹의 기기에만, 없으면 모든 기기에', async () => {
    const everyone = await insertSubmission({ status: 'PUBLISHED' });
    const onlyGroup1 = await insertSubmission({
      status: 'PUBLISHED',
      targetGroupIds: [group1],
    });
    const both = await insertSubmission({
      status: 'PUBLISHED',
      targetGroupIds: [group1, group2],
    });
    const ids = [everyone, onlyGroup1, both];

    expect((await ourItemIds(inGroup1, ids)).sort()).toEqual(
      [everyone, onlyGroup1, both].sort(),
    );
    expect((await ourItemIds(inGroup2, ids)).sort()).toEqual(
      [everyone, both].sort(),
    );
    expect(await ourItemIds(noGroup, ids)).toEqual([everyone]);
  });

  it('검증이 끝나지 않은 포스터는 뺀다', async () => {
    const [pending] = await db
      .insert(assets)
      .values({
        ownerId: requester.user.id,
        fileName: 'p.jpg',
        declaredMimeType: 'image/jpeg',
        declaredSizeBytes: 1,
        uploadExpiresAt: new Date(),
      })
      .returning({ id: assets.id });
    const id = await insertSubmission({ status: 'PUBLISHED' });
    await db
      .update(submissions)
      .set({ assetId: pending.id })
      .where(eq(submissions.id, id));

    expect(await ourItemIds(noGroup, [id])).toEqual([]);
  });

  it('우선순위 높은 순, 같으면 시작이 이른 순이고 항목 형태가 맞다', async () => {
    const low = await insertSubmission({
      status: 'PUBLISHED',
      priority: 0,
      startAt: at(-3 * HOUR),
      targetGroupIds: [group1],
    });
    const lateHigh = await insertSubmission({
      status: 'PUBLISHED',
      priority: 5,
      startAt: at(-HOUR),
      targetGroupIds: [group1],
    });
    const earlyHigh = await insertSubmission({
      status: 'PUBLISHED',
      priority: 5,
      startAt: at(-2 * HOUR),
      targetGroupIds: [group1],
      title: '가장 먼저',
    });

    const res = await fetchPlaylist(inGroup1).expect(200);
    const ours = res.body.items.filter((item: { submissionId: string }) =>
      [low, lateHigh, earlyHigh].includes(item.submissionId),
    );
    expect(
      ours.map((item: { submissionId: string }) => item.submissionId),
    ).toEqual([earlyHigh, lateHigh, low]);

    expect(ours[0]).toEqual({
      submissionId: earlyHigh,
      revision: 1,
      title: '가장 먼저',
      category: '공연',
      assetUrl: `https://cdn.test/assets/${assetId}/tv.webp`,
      detailUrl: 'https://ziggle.gistory.me/notice/1',
      startsAt: expect.any(String),
      endsAt: expect.any(String),
      priority: 5,
      checksum: `sha256:${'0'.repeat(64)}`,
      subtitle: '부제',
      location: '대강당',
      organizerName: '공연동아리',
    });
    expect(res.body).toMatchObject({
      refreshAfterSeconds: 60,
      layout: { type: 'SINGLE', rotationSeconds: 15 },
      serverTime: expect.any(String),
    });
  });

  describe('조건부 요청 (ETag)', () => {
    it('편성이 그대로면 304, 바뀌면 새 버전으로 200', async () => {
      const first = await fetchPlaylist(inGroup2).expect(200);
      const etag = first.headers.etag;
      expect(etag).toBe(`"${first.body.playlistVersion}"`);
      expect(first.headers['cache-control']).toBe('private, no-cache');

      const same = await fetchPlaylist(inGroup2, etag).expect(304);
      expect(same.text).toBe('');

      // 게시물이 하나 중단되면 다음 요청부터 빠진다
      const id = await insertSubmission({
        status: 'PUBLISHED',
        targetGroupIds: [group2],
      });
      const added = await fetchPlaylist(inGroup2, etag).expect(200);
      expect(added.body.playlistVersion).not.toBe(first.body.playlistVersion);

      await db
        .update(submissions)
        .set({ status: 'SUSPENDED' })
        .where(eq(submissions.id, id));
      const removed = await fetchPlaylist(inGroup2, added.headers.etag).expect(
        200,
      );
      expect(
        removed.body.items.map(
          (item: { submissionId: string }) => item.submissionId,
        ),
      ).not.toContain(id);
      // 원래 편성으로 돌아왔으니 처음 버전과 같다
      expect(removed.body.playlistVersion).toBe(first.body.playlistVersion);
    });

    it('기기 화면 설정이 바뀌어도 버전이 바뀐다', async () => {
      const first = await fetchPlaylist(noGroup).expect(200);
      await request(app.getHttpServer())
        .patch(`/signage/devices/${noGroup.id}`)
        .set('Authorization', admin.authHeader)
        .send({ refreshAfterSeconds: 30 })
        .expect(200);

      const next = await fetchPlaylist(noGroup, first.headers.etag).expect(200);
      expect(next.body.refreshAfterSeconds).toBe(30);
    });
  });

  it('게시물이 없으면 빈 items (오류 아님)', async () => {
    const lonely = await register([group2]);
    const res = await fetchPlaylist(lonely).expect(200);
    const ours = await ourItemIds(lonely, []);
    expect(ours).toEqual([]);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('기기 토큰이 없으면 401, 다른 기기 경로는 403', async () => {
    await request(app.getHttpServer())
      .get(`/signage/devices/${inGroup1.id}/playlist`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/signage/devices/${inGroup2.id}/playlist`)
      .set('X-Device-Token', inGroup1.token)
      .expect(403);
  });
});
