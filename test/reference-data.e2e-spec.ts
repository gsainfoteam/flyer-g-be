import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { categories, targetGroups } from '../src/db/schema.js';
import {
  createTestUser,
  type TestUser,
  uniqueSlug,
} from './helpers/test-user.js';

describe('참조 데이터와 운영 설정 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let member: TestUser;

  const hiddenCategoryId = uniqueSlug('cat');
  const groupIds = {
    first: uniqueSlug('grp'),
    second: uniqueSlug('grp'),
    hidden: uniqueSlug('grp'),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    await db
      .insert(categories)
      .values({ id: hiddenCategoryId, name: '숨김', isActive: false });
    // 정렬 확인을 위해 sortOrder를 id 순서와 반대로 둔다.
    await db.insert(targetGroups).values([
      { id: groupIds.first, name: 'E2E 그룹 1', sortOrder: -2 },
      { id: groupIds.second, name: 'E2E 그룹 2', sortOrder: -3 },
      { id: groupIds.hidden, name: 'E2E 숨김', sortOrder: -1, isActive: false },
    ]);

    member = await createTestUser(app);
  });

  afterAll(async () => {
    await member.remove();
    await db
      .delete(targetGroups)
      .where(inArray(targetGroups.id, Object.values(groupIds)));
    await db
      .delete(categories)
      .where(inArray(categories.id, [hiddenCategoryId]));
    await app.close();
  });

  const get = (path: string, auth?: TestUser) => {
    const req = request(app.getHttpServer()).get(path);
    return auth ? req.set('Authorization', auth.authHeader) : req;
  };

  it.each(['/signage/categories', '/signage/target-groups', '/signage/config'])(
    '%s는 로그인이 필요하다',
    async (path) => {
      const res = await get(path).expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    },
  );

  it('카테고리: 초기값을 노출 순서대로 주고 숨긴 카테고리는 뺀다', async () => {
    const res = await get('/signage/categories', member).expect(200);
    const ids = res.body.map((c: { id: string }) => c.id);

    expect(res.body.slice(0, 5)).toEqual([
      { id: 'notice', name: '공지' },
      { id: 'club', name: '동아리' },
      { id: 'performance', name: '공연' },
      { id: 'event', name: '행사' },
      { id: 'department', name: '학과·부서' },
    ]);
    expect(ids).not.toContain(hiddenCategoryId);
  });

  it('대상 그룹: sortOrder 순서, 숨긴 그룹 제외, deviceCount 포함', async () => {
    const res = await get('/signage/target-groups', member).expect(200);
    const ours = res.body.filter((g: { id: string }) =>
      Object.values(groupIds).includes(g.id),
    );

    expect(ours).toEqual([
      { id: groupIds.second, name: 'E2E 그룹 2', deviceCount: 0 },
      { id: groupIds.first, name: 'E2E 그룹 1', deviceCount: 0 },
    ]);
  });

  it('운영 설정: 서버 검증에 쓰는 값을 준다', async () => {
    const res = await get('/signage/config', member).expect(200);

    expect(res.body).toEqual({
      maxUploadBytes: 10485760,
      minShortEdgePx: 1080,
      titleMaxLength: 80,
      maxPublishMonths: 3,
      minLeadTimeHours: 24,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      allowedDetailUrlHosts: ['ziggle.gistory.me'],
    });
  });

  it('DB: slug 형식이 아닌 ID는 거절한다', async () => {
    await expect(
      db.insert(targetGroups).values({ id: 'Group With Space', name: 'x' }),
    ).rejects.toThrow();
  });
});
