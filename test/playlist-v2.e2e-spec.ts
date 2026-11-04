import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  auditLogs,
  devices,
  programs,
  submissionEventBanners,
  submissionStories,
  submissionTargetGroups,
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

const HOUR = 3600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs);
// 다른 데이터의 제보 번호와 겹치지 않게 큰 수를 쓴다
const STORY_NUMBER = 1_000_000 + Math.floor(Math.random() * 1_000_000);

type RegisteredDevice = { id: string; token: string };

describe('편성 v2와 미리보기 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let admin: TestUser;
  let reviewer: TestUser;
  let requester: TestUser;
  let groupId: string;
  let device: RegisteredDevice;
  let assetId: string;
  const submissionIds: string[] = [];
  const programId = `prg_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const hiddenProgramId = `${programId}_off`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new MemoryStorage())
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);

    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    requester = await createTestUser(app);
    assetId = await createReadyAsset(app, requester.user.id);
    groupId = await createTestGroup(app);

    const now = new Date();
    await db.insert(programs).values(
      [programId, hiddenProgramId].map((id) => ({
        id,
        type: 'DDAY',
        name: `E2E ${id}`,
        params: { label: '기말고사' },
        createdAt: now,
        updatedAt: now,
      })),
    );

    const res = await request(server())
      .post('/signage/devices')
      .set('Authorization', admin.authHeader)
      .send({ name: 'E2E v2 TV', groupIds: [groupId] })
      .expect(201);
    device = { id: res.body.id, token: res.body.token };
  });

  afterAll(async () => {
    await db.delete(submissions).where(inArray(submissions.id, submissionIds));
    await db.delete(auditLogs).where(eq(auditLogs.targetId, device.id));
    await db.delete(devices).where(eq(devices.id, device.id));
    // 편성(블록)이 그룹과 같이 지워진 뒤에 운영 컨텐츠를 지운다
    await db.delete(targetGroups).where(eq(targetGroups.id, groupId));
    await db
      .delete(programs)
      .where(inArray(programs.id, [programId, hiddenProgramId]));
    for (const user of [admin, reviewer, requester]) {
      await user.remove();
    }
    await app.close();
  });

  const server = () => app.getHttpServer();

  const fetchV2 = (etag?: string) => {
    const req = request(server())
      .get(`/signage/devices/${device.id}/playlist?v=2`)
      .set('X-Device-Token', device.token);
    return etag ? req.set('If-None-Match', etag) : req;
  };

  /** 상태·기간을 맞추려고 API를 거치지 않고 넣는다. 이 그룹만 대상으로 한다(제보는 전체) */
  async function insertPublished(
    values: Partial<typeof submissions.$inferInsert>,
  ): Promise<string> {
    const now = new Date();
    const [row] = await db
      .insert(submissions)
      .values({
        requesterId: requester.user.id,
        title: 'E2E v2',
        startAt: at(-HOUR),
        endAt: at(HOUR),
        status: 'PUBLISHED',
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
        ...values,
      })
      .returning({ id: submissions.id });
    submissionIds.push(row.id);
    if (values.type !== 'STORY') {
      await db
        .insert(submissionTargetGroups)
        .values({ submissionId: row.id, targetGroupId: groupId });
    }
    return row.id;
  }

  it('그룹 편성과 모든 종류의 게시 중인 신청을 싣는다', async () => {
    const posterId = await insertPublished({
      type: 'POSTER',
      title: 'E2E v2 포스터',
      categoryId: 'performance',
      assetId,
    });
    const bannerId = await insertPublished({
      type: 'EVENT_BANNER',
      title: '생일 · 지민에게',
    });
    await db.insert(submissionEventBanners).values({
      submissionId: bannerId,
      mode: 'TEMPLATE',
      occasion: 'BIRTHDAY',
      recipient: '지민',
      headline: '지민아, 생일 축하해',
      message: '생일 축하해!',
      sender: null,
      photoConsent: false,
    });
    const storyId = await insertPublished({ type: 'STORY', title: '제보' });
    await db.insert(submissionStories).values({
      submissionId: storyId,
      tag: 'PRAISE',
      body: '세탁실 건조기가 고쳐졌어요. 감사합니다!',
      storyNumber: STORY_NUMBER,
    });
    // 기간이 끝난 배너는 빠진다
    await insertPublished({
      type: 'EVENT_BANNER',
      startAt: at(-2 * HOUR),
      endAt: at(-HOUR),
    });

    // 블록: 포스터·배너·제보·운영 컨텐츠, 꺼진 운영 컨텐츠 블록
    const lineup = await request(server())
      .get(`/signage/target-groups/${groupId}/lineup`)
      .set('Authorization', admin.authHeader)
      .expect(200);
    const saved = await request(server())
      .put(`/signage/target-groups/${groupId}/lineup`)
      .set('Authorization', admin.authHeader)
      .send({
        version: lineup.body.version,
        settings: { ...lineup.body.settings, posterLayout: 'STRIP' },
        blocks: [
          lineup.body.blocks[0],
          {
            source: 'SUBMISSIONS',
            submissionType: 'EVENT_BANNER',
            durationSeconds: 10,
          },
          {
            source: 'SUBMISSIONS',
            submissionType: 'STORY',
            durationSeconds: 10,
          },
          { source: 'PROGRAM', programId, durationSeconds: 5 },
          {
            source: 'PROGRAM',
            programId: hiddenProgramId,
            durationSeconds: 5,
            enabled: false,
          },
        ],
      })
      .expect(200);
    const [posters, banners] = saved.body.blocks;
    // 기기 예외로 배너 블록을 끄고 회전 간격을 바꾼다
    await request(server())
      .patch(`/signage/devices/${device.id}`)
      .set('Authorization', admin.authHeader)
      .send({
        overrides: {
          settings: { rotationSeconds: 20 },
          blocks: { [banners.id]: { enabled: false } },
        },
      })
      .expect(200);

    const res = await fetchV2().expect(200);
    const body = res.body;
    expect(res.headers.etag).toBe(`"${body.playlistVersion}"`);
    expect(body).toMatchObject({
      timezone: 'Asia/Seoul',
      deviceName: 'E2E v2 TV',
      refreshAfterSeconds: 60,
      settings: { posterLayout: 'STRIP', rotationSeconds: 20 },
      live: null,
    });
    expect(body.blocks.map((b: { id: string }) => b.id)).toEqual([
      posters.id,
      saved.body.blocks[2].id,
      saved.body.blocks[3].id,
    ]);
    // 꺼진 블록만 가리키는 운영 컨텐츠는 싣지 않는다
    expect(body.programs).toEqual({
      [programId]: {
        type: 'DDAY',
        name: `E2E ${programId}`,
        params: { label: '기말고사' },
        data: null,
      },
    });

    // 포스터는 v1 items와 같은 모양이다
    const v1 = await request(server())
      .get(`/signage/devices/${device.id}/playlist`)
      .set('X-Device-Token', device.token)
      .expect(200);
    expect(body.submissions.POSTER).toEqual(
      v1.body.items.filter(
        (item: { submissionId: string }) => item.submissionId === posterId,
      ),
    );
    expect(v1.body.playlistVersion).not.toBe(body.playlistVersion);
    expect(v1.body.layout).toEqual({ type: 'STRIP', rotationSeconds: 20 });

    expect(body.submissions.EVENT_BANNER).toEqual([
      {
        submissionId: bannerId,
        revision: 1,
        startsAt: expect.any(String),
        endsAt: expect.any(String),
        checksum: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        mode: 'TEMPLATE',
        occasion: 'BIRTHDAY',
        recipient: '지민',
        headline: '지민아, 생일 축하해',
        message: '생일 축하해!',
        sender: null,
        photoUrl: null,
        assetUrl: null,
        width: null,
        height: null,
      },
    ]);
    const story = body.submissions.STORY.find(
      (item: { submissionId: string }) => item.submissionId === storyId,
    );
    expect(story).toEqual({
      submissionId: storyId,
      revision: 1,
      startsAt: expect.any(String),
      endsAt: expect.any(String),
      checksum: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      storyNumber: STORY_NUMBER,
      tag: 'PRAISE',
      body: '세탁실 건조기가 고쳐졌어요. 감사합니다!',
    });
    // 제보 작성자는 어디에도 없다
    expect(JSON.stringify(body)).not.toContain(requester.user.id);
    expect(JSON.stringify(body)).not.toContain(requester.user.name);
  });

  it('ETag가 같으면 304, 내용이 바뀌면 새 버전', async () => {
    const first = await fetchV2().expect(200);
    await fetchV2(first.headers.etag).expect(304);

    await db
      .update(submissionStories)
      .set({ body: '세탁실 건조기가 고쳐졌어요. 정말 감사합니다!' })
      .where(inArray(submissionStories.submissionId, submissionIds));
    const next = await fetchV2(first.headers.etag).expect(200);
    expect(next.body.playlistVersion).not.toBe(first.body.playlistVersion);
  });

  it('v가 1·2가 아니면 422', async () => {
    const res = await request(server())
      .get(`/signage/devices/${device.id}/playlist?v=3`)
      .set('X-Device-Token', device.token)
      .expect(422);
    expect(res.body.fields).toEqual({ v: 'v는 1 또는 2여야 합니다.' });
  });

  describe('미리보기', () => {
    const preview = (id: string, user: TestUser) =>
      request(server())
        .get(`/signage/devices/${id}/playlist-preview`)
        .set('Authorization', user.authHeader);

    it('검토자는 기기가 받을 v2와 같은 결과를 본다. 기기 상태는 바뀌지 않는다', async () => {
      const [before] = await db
        .select()
        .from(devices)
        .where(eq(devices.id, device.id));

      const res = await preview(device.id, reviewer).expect(200);
      // 기기용 ETag(playlistVersion)를 주지 않고 캐시하지 않는다
      expect(res.headers.etag).not.toBe(`"${res.body.playlistVersion}"`);
      expect(res.headers['cache-control']).toBe('no-store');
      const tv = await fetchV2().expect(200);
      const { serverTime: _a, ...previewBody } = res.body;
      const { serverTime: _b, ...tvBody } = tv.body;
      expect(previewBody).toEqual(tvBody);

      const [after] = await db
        .select()
        .from(devices)
        .where(eq(devices.id, device.id));
      expect(after.lastSeenAt).toEqual(before.lastSeenAt);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    it('일반 사용자는 403, 없는 기기는 404', async () => {
      await preview(device.id, requester).expect(403);
      await preview(randomUUID(), reviewer).expect(404);
      await preview('not-a-uuid', reviewer).expect(404);
    });
  });
});
