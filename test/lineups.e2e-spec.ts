import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  auditLogs,
  groupLineups,
  programs,
  targetGroups,
} from '../src/db/schema.js';
import { createTestUser, type TestUser } from './helpers/test-user.js';

type Block = { id: string; source: string; [key: string]: unknown };
type Lineup = {
  groupId: string;
  version: number;
  settings: Record<string, unknown>;
  blocks: Block[];
  updatedBy: { id: string; name: string } | null;
};

describe('그룹 편성 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let admin: TestUser;
  let reviewer: TestUser;
  const groupIds: string[] = [];
  const programId = `prg_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const tag = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);

    admin = await createTestUser(app, { roles: ['SUPER_ADMIN'] });
    reviewer = await createTestUser(app, { roles: ['REVIEWER'] });
    // 준비를 줄이려고 API를 거치지 않고 넣는다
    const now = new Date();
    await db.insert(programs).values({
      id: programId,
      type: 'CLICK_BATTLE',
      name: 'E2E 클릭 배틀',
      params: { rounds: 3 },
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.targetId, groupIds));
    // 편성(블록)은 그룹과 같이 지워진다. 블록이 지워진 뒤에 운영 컨텐츠를 지운다
    await db.delete(targetGroups).where(inArray(targetGroups.id, groupIds));
    await db.delete(programs).where(eq(programs.id, programId));
    await admin.remove();
    await reviewer.remove();
    await app.close();
  });

  const server = () => app.getHttpServer();

  async function createGroup(): Promise<string> {
    const res = await request(server())
      .post('/signage/target-groups')
      .set('Authorization', admin.authHeader)
      .send({ name: `E2E 편성 ${tag} ${groupIds.length}` })
      .expect(201);
    groupIds.push(res.body.id);
    return res.body.id;
  }

  const getLineup = async (groupId: string): Promise<Lineup> =>
    (
      await request(server())
        .get(`/signage/target-groups/${groupId}/lineup`)
        .set('Authorization', admin.authHeader)
        .expect(200)
    ).body;

  const put = (groupId: string, body: object, user = admin) =>
    request(server())
      .put(`/signage/target-groups/${groupId}/lineup`)
      .set('Authorization', user.authHeader)
      .send(body);

  it('그룹을 만들면 기본 편성이 같이 생긴다', async () => {
    const groupId = await createGroup();
    const lineup = await getLineup(groupId);

    expect(lineup).toMatchObject({
      groupId,
      version: 1,
      settings: {
        posterLayout: 'WALL',
        rotationSeconds: 10,
        refreshAfterSeconds: 60,
        infoBar: [],
        quietHours: [],
      },
      updatedBy: null,
    });
    expect(lineup.blocks).toEqual([
      {
        id: expect.stringMatching(/^blk_[0-9a-f]{12}$/),
        source: 'SUBMISSIONS',
        submissionType: 'POSTER',
        programId: null,
        durationSeconds: 60,
        perVisit: 3,
        schedule: { type: 'ALWAYS' },
        enabled: true,
      },
    ]);
  });

  it('SUPER_ADMIN만 보고 저장한다. 없는 그룹은 404', async () => {
    const groupId = await createGroup();
    await request(server())
      .get(`/signage/target-groups/${groupId}/lineup`)
      .set('Authorization', reviewer.authHeader)
      .expect(403);
    await put(groupId, {}, reviewer).expect(403);

    await request(server())
      .get('/signage/target-groups/grp_nope_lineup/lineup')
      .set('Authorization', admin.authHeader)
      .expect(404);
    const lineup = await getLineup(groupId);
    await put('grp_nope_lineup', {
      version: 1,
      settings: lineup.settings,
      blocks: [],
    }).expect(404);
  });

  it('블록을 고치고 더하고 지운다. 생략한 값은 기본값이고 version이 오른다', async () => {
    const groupId = await createGroup();
    const lineup = await getLineup(groupId);
    const [posters] = lineup.blocks;

    const res = await put(groupId, {
      version: lineup.version,
      settings: {
        ...lineup.settings,
        posterLayout: 'STRIP',
        quietHours: [{ start: '23:00', end: '06:00' }],
      },
      blocks: [
        { source: 'SUBMISSIONS', submissionType: 'STORY', durationSeconds: 20 },
        // GET 응답을 그대로 고쳐 보낸다(해당 없는 필드는 null)
        { ...posters, durationSeconds: 90 },
        {
          source: 'PROGRAM',
          programId,
          durationSeconds: 15,
          schedule: {
            type: 'WINDOWS',
            windows: [{ days: [1, 2, 3, 4, 5], start: '07:00', end: '09:30' }],
          },
          enabled: false,
        },
      ],
    }).expect(200);

    const body = res.body as Lineup;
    expect(body.version).toBe(lineup.version + 1);
    expect(body.settings).toMatchObject({
      posterLayout: 'STRIP',
      quietHours: [{ start: '23:00', end: '06:00' }],
    });
    expect(body.updatedBy).toEqual({
      id: admin.user.id,
      name: admin.user.name,
    });
    expect(body.blocks).toEqual([
      {
        id: expect.stringMatching(/^blk_/),
        source: 'SUBMISSIONS',
        submissionType: 'STORY',
        programId: null,
        durationSeconds: 20,
        perVisit: 2,
        schedule: { type: 'ALWAYS' },
        enabled: true,
      },
      { ...posters, durationSeconds: 90 },
      {
        id: expect.stringMatching(/^blk_/),
        source: 'PROGRAM',
        submissionType: null,
        programId,
        durationSeconds: 15,
        perVisit: null,
        schedule: {
          type: 'WINDOWS',
          windows: [{ days: [1, 2, 3, 4, 5], start: '07:00', end: '09:30' }],
        },
        enabled: false,
      },
    ]);
    expect(body.blocks[0].id).not.toBe(posters.id);

    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetId, groupId),
          eq(auditLogs.action, 'LINEUP_UPDATED'),
        ),
      );
    expect(logs.map((log) => [log.targetType, log.metadata])).toEqual([
      ['GROUP', { version: lineup.version + 1, blockCount: 3 }],
    ]);

    // 운영 컨텐츠를 블록이 가리키면 지울 수 없다(RESTRICT)
    await expect(
      db.delete(programs).where(eq(programs.id, programId)),
    ).rejects.toThrow();

    // 보내지 않은 블록은 지워진다
    const emptied = await put(groupId, {
      version: body.version,
      settings: body.settings,
      blocks: [],
    }).expect(200);
    expect(emptied.body.blocks).toEqual([]);
  });

  it('version이 최신이 아니면 409', async () => {
    const groupId = await createGroup();
    const lineup = await getLineup(groupId);
    const body = {
      version: lineup.version,
      settings: lineup.settings,
      blocks: lineup.blocks,
    };
    await put(groupId, body).expect(200);
    const res = await put(groupId, body).expect(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('입력 검증은 점 경로 필드 오류로 준다', async () => {
    const groupId = await createGroup();
    const lineup = await getLineup(groupId);
    const res = await put(groupId, {
      version: lineup.version,
      settings: {
        ...lineup.settings,
        rotationSeconds: 3,
        quietHours: [{ start: '02:00', end: '02:00' }],
        extra: 1,
      },
      blocks: [
        { source: 'SUBMISSIONS', submissionType: 'POSTER', programId },
        { source: 'NOPE' },
        {
          source: 'PROGRAM',
          programId,
          durationSeconds: 10,
          schedule: {
            type: 'DATE_RANGE',
            from: '2026-11-03T00:00:00Z',
            to: '2026-11-02T00:00:00Z',
          },
        },
      ],
    }).expect(422);

    expect(res.body.fields).toEqual({
      settings: '알 수 없는 항목이 있습니다: extra',
      'settings.rotationSeconds': '전환 간격은 5초 이상이어야 합니다.',
      'settings.quietHours.0.end': '시작과 끝 시각이 같을 수 없습니다.',
      'blocks.0.durationSeconds': '블록 길이는 정수여야 합니다.',
      'blocks.0.programId': 'SUBMISSIONS 블록은 programId를 쓰지 않습니다.',
      'blocks.1.source': '블록 종류가 올바르지 않습니다.',
      'blocks.2.schedule.to': '끝 시각은 시작 시각보다 뒤여야 합니다.',
    });
  });

  it('블록 id와 운영 컨텐츠 참조는 서버가 확인한다', async () => {
    const groupId = await createGroup();
    const other = await getLineup(await createGroup());
    const lineup = await getLineup(groupId);
    const [posters] = lineup.blocks;

    const res = await put(groupId, {
      version: lineup.version,
      settings: {
        ...lineup.settings,
        // 클릭 배틀은 정보줄에 들어갈 수 없는 종류다
        infoBar: [{ item: 'DDAY', programId }],
      },
      blocks: [
        posters,
        posters,
        other.blocks[0],
        { source: 'PROGRAM', programId: 'prg_nope', durationSeconds: 10 },
      ],
    }).expect(422);

    expect(res.body.fields).toEqual({
      'blocks.1.id': '같은 블록을 두 번 넣을 수 없습니다.',
      'blocks.2.id': '이 그룹에 없는 블록입니다. 새 블록은 id 없이 보내세요.',
      'blocks.3.programId': '없는 운영 컨텐츠입니다.',
      'settings.infoBar.0.programId':
        '이 운영 컨텐츠는 정보줄의 DDAY 칸에 쓸 수 없습니다.',
    });
    expect((await getLineup(groupId)).version).toBe(lineup.version);
  });

  it('그룹을 지우면 편성도 지워진다', async () => {
    const groupId = await createGroup();
    await request(server())
      .delete(`/signage/target-groups/${groupId}`)
      .set('Authorization', admin.authHeader)
      .expect(204);
    const rows = await db
      .select()
      .from(groupLineups)
      .where(eq(groupLineups.groupId, groupId));
    expect(rows).toEqual([]);
  });
});
