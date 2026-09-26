import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import {
  uploadKey,
  variantKey,
  variantKeysOf,
} from '../src/assets/assets.service.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import {
  assets,
  auditLogs,
  idempotencyKeys,
  storageDeletions,
  submissions,
  type SubmissionStatus,
} from '../src/db/schema.js';
import { AssetCleanupJob } from '../src/jobs/asset-cleanup.job.js';
import { SchedulerService } from '../src/jobs/scheduler.service.js';
import { SubmissionStatusJob } from '../src/jobs/submission-status.job.js';
import { StorageService } from '../src/storage/storage.service.js';
import { MemoryStorage } from './helpers/memory-storage.js';
import {
  createReadyAsset,
  createTestUser,
  type TestUser,
} from './helpers/test-user.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe('주기 작업 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let storage: MemoryStorage;
  let user: TestUser;
  let statusJob: SubmissionStatusJob;
  let assetJob: AssetCleanupJob;

  beforeAll(async () => {
    storage = new MemoryStorage();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    // 파일 동안 포트를 하나로 고정한다. supertest가 요청마다 서버를 열고 닫으면
    // 동시 요청 중 하나가 닫힌 서버에 걸려 끊긴다(socket hang up).
    await app.listen(0);
    db = app.get<Database>(DB_CONNECTION);
    statusJob = app.get(SubmissionStatusJob);
    assetJob = app.get(AssetCleanupJob);
    user = await createTestUser(app);
  });

  afterAll(async () => {
    await user.remove();
    await app.close();
  });

  describe('상태 동기화', () => {
    let assetId: string;
    const ids: Record<string, string> = {};

    async function insert(
      name: string,
      status: SubmissionStatus,
      startOffset: number,
      endOffset: number,
    ) {
      const now = new Date();
      const [row] = await db
        .insert(submissions)
        .values({
          requesterId: user.user.id,
          title: `E2E 스케줄러 ${name}`,
          categoryId: 'event',
          assetId,
          startAt: new Date(now.getTime() + startOffset),
          endAt: new Date(now.getTime() + endOffset),
          status,
          submittedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: submissions.id });
      ids[name] = row.id;
    }

    beforeAll(async () => {
      assetId = await createReadyAsset(app, user.user.id);
      await insert('approvedFuture', 'APPROVED', HOUR, 2 * HOUR);
      await insert('approvedNow', 'APPROVED', -HOUR, HOUR);
      await insert('scheduledStarted', 'SCHEDULED', -HOUR, HOUR);
      await insert('scheduledFuture', 'SCHEDULED', HOUR, 2 * HOUR);
      await insert('publishedOver', 'PUBLISHED', -2 * HOUR, -HOUR);
      await insert('scheduledOver', 'SCHEDULED', -2 * HOUR, -HOUR);
      await insert('publishedNow', 'PUBLISHED', -HOUR, HOUR);
      await insert('suspended', 'SUSPENDED', -HOUR, HOUR);
      await insert('canceled', 'CANCELED', -HOUR, HOUR);
      await insert('pending', 'PENDING_REVIEW', -2 * HOUR, -HOUR);
    });

    async function statusOf(name: string) {
      const [row] = await db
        .select({ status: submissions.status, version: submissions.version })
        .from(submissions)
        .where(eq(submissions.id, ids[name]));
      return row;
    }

    it('기간에 맞춰 상태를 바꾸고 version을 올린다', async () => {
      const result = await statusJob.run();
      expect(result).not.toBeNull();

      const expected: Record<string, [SubmissionStatus, number]> = {
        approvedFuture: ['SCHEDULED', 2],
        approvedNow: ['PUBLISHED', 2],
        scheduledStarted: ['PUBLISHED', 2],
        scheduledFuture: ['SCHEDULED', 1],
        publishedOver: ['ENDED', 2],
        scheduledOver: ['ENDED', 2],
        publishedNow: ['PUBLISHED', 1],
        // 승인 흐름 밖의 상태는 건드리지 않는다
        suspended: ['SUSPENDED', 1],
        canceled: ['CANCELED', 1],
        pending: ['PENDING_REVIEW', 1],
      };
      for (const [name, [status, version]] of Object.entries(expected)) {
        expect({ name, ...(await statusOf(name)) }).toEqual({
          name,
          status,
          version,
        });
      }
      expect(result!.scheduled).toBeGreaterThanOrEqual(1);
      expect(result!.published).toBeGreaterThanOrEqual(2);
      expect(result!.ended).toBeGreaterThanOrEqual(2);
    });

    it('시스템 행위자로 감사 로그를 남긴다', async () => {
      const logs = await db
        .select()
        .from(auditLogs)
        .where(
          inArray(auditLogs.targetId, [
            ids.approvedFuture,
            ids.approvedNow,
            ids.publishedOver,
          ]),
        );
      expect(
        logs
          .map((log) => [log.targetId, log.action, log.actorType, log.actorId])
          .sort(),
      ).toEqual(
        [
          [ids.approvedFuture, 'SUBMISSION_SCHEDULED', 'SYSTEM', null],
          [ids.approvedNow, 'SUBMISSION_PUBLISHED', 'SYSTEM', null],
          [ids.publishedOver, 'SUBMISSION_ENDED', 'SYSTEM', null],
        ].sort(),
      );
      await db
        .delete(auditLogs)
        .where(inArray(auditLogs.targetId, Object.values(ids)));
    });

    it('다시 돌려도 이미 맞춘 것은 바꾸지 않는다', async () => {
      await statusJob.run();
      expect(await statusOf('approvedFuture')).toEqual({
        status: 'SCHEDULED',
        version: 2,
      });
    });

    it('다른 곳이 잠금을 잡고 있으면 건너뛴다', async () => {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(1179207270::int, 1::int)`,
        );
        // 다른 커넥션에서 도는 작업은 잠금을 얻지 못한다
        expect(await statusJob.run()).toBeNull();
      });
    });

    it('스케줄러가 꺼져 있으면(SCHEDULER_ENABLED=false) 주기 실행이 아무것도 하지 않는다', async () => {
      await db
        .update(submissions)
        .set({ status: 'APPROVED' })
        .where(eq(submissions.id, ids.scheduledFuture));
      await app.get(SchedulerService).syncSubmissionStatus();
      expect((await statusOf('scheduledFuture')).status).toBe('APPROVED');
    });
  });

  describe('업로드 정리', () => {
    async function insertAsset(values: {
      status: 'PENDING_UPLOAD' | 'READY' | 'REJECTED';
      ageMs: number;
      uploadExpiredMs?: number;
    }): Promise<string> {
      const now = Date.now();
      const [row] = await db
        .insert(assets)
        .values({
          ownerId: user.user.id,
          status: values.status,
          fileName: 'p.jpg',
          declaredMimeType: 'image/jpeg',
          declaredSizeBytes: 1,
          uploadExpiresAt: new Date(now - (values.uploadExpiredMs ?? 0)),
          createdAt: new Date(now - values.ageMs),
          ...(values.status === 'READY' && {
            mimeType: 'image/jpeg',
            width: 1080,
            height: 1080,
            sizeBytes: 1,
            checksum: `sha256:${'1'.repeat(64)}`,
          }),
        })
        .returning({ id: assets.id });
      return row.id;
    }

    const exists = async (id: string) =>
      (await db.select().from(assets).where(eq(assets.id, id))).length === 1;

    it('끝나지 않은 업로드·안 쓰는 이미지·오래된 거절 건을 지우고, 쓰는 것과 최근 것은 남긴다', async () => {
      const pendingExpired = await insertAsset({
        status: 'PENDING_UPLOAD',
        ageMs: 3 * HOUR,
        uploadExpiredMs: 2 * HOUR,
      });
      const pendingFresh = await insertAsset({
        status: 'PENDING_UPLOAD',
        ageMs: 10 * 60_000,
        uploadExpiredMs: -5 * 60_000,
      });
      const unusedOld = await insertAsset({ status: 'READY', ageMs: 4 * DAY });
      const unusedRecent = await insertAsset({ status: 'READY', ageMs: DAY });
      const usedOld = await insertAsset({ status: 'READY', ageMs: 30 * DAY });
      const rejectedOld = await insertAsset({
        status: 'REJECTED',
        ageMs: 8 * DAY,
      });
      const rejectedRecent = await insertAsset({
        status: 'REJECTED',
        ageMs: DAY,
      });

      // 신청이 가리키는 오래된 이미지
      const now = new Date();
      await db.insert(submissions).values({
        requesterId: user.user.id,
        title: 'E2E 정리 대상 아님',
        categoryId: 'event',
        assetId: usedOld,
        startAt: now,
        endAt: new Date(now.getTime() + HOUR),
        status: 'ENDED',
        createdAt: now,
        updatedAt: now,
      });

      storage.upload(uploadKey(pendingExpired), Buffer.from('original'));
      for (const variant of ['thumb', 'preview', 'tv'] as const) {
        storage.upload(variantKey(unusedOld, variant), Buffer.from('v'));
        storage.upload(variantKey(usedOld, variant), Buffer.from('v'));
      }

      const result = await assetJob.run();
      expect(result).not.toBeNull();

      expect({
        pendingExpired: await exists(pendingExpired),
        pendingFresh: await exists(pendingFresh),
        unusedOld: await exists(unusedOld),
        unusedRecent: await exists(unusedRecent),
        usedOld: await exists(usedOld),
        rejectedOld: await exists(rejectedOld),
        rejectedRecent: await exists(rejectedRecent),
      }).toEqual({
        pendingExpired: false,
        pendingFresh: true,
        unusedOld: false,
        unusedRecent: true,
        usedOld: true,
        rejectedOld: false,
        rejectedRecent: true,
      });

      // 지운 asset의 파일도 지워지고, 쓰는 asset의 파일은 남는다
      expect(storage.objects.has(uploadKey(pendingExpired))).toBe(false);
      expect(storage.objects.has(variantKey(unusedOld, 'tv'))).toBe(false);
      expect(storage.objects.has(variantKey(usedOld, 'tv'))).toBe(true);
      expect(result!.filesFailed).toBe(0);
      expect(await queued([uploadKey(pendingExpired)])).toEqual([]);
    });

    const queued = async (keys: string[]) =>
      db
        .select()
        .from(storageDeletions)
        .where(inArray(storageDeletions.key, keys));

    it('파일 삭제가 실패하면 대기열에 남겨 다음 실행에서 다시 지운다', async () => {
      const unused = await insertAsset({ status: 'READY', ageMs: 4 * DAY });
      const tvKey = variantKey(unused, 'tv');
      for (const variant of ['thumb', 'preview', 'tv'] as const) {
        storage.upload(variantKey(unused, variant), Buffer.from('v'));
      }
      storage.failDeletes.add(tvKey);

      const first = await assetJob.run();
      // 행은 지워졌지만 실패한 파일의 키는 남았다
      expect(await exists(unused)).toBe(false);
      expect(storage.objects.has(tvKey)).toBe(true);
      expect(storage.objects.has(variantKey(unused, 'thumb'))).toBe(false);
      expect(first!.filesFailed).toBe(1);
      const [pending] = await queued([tvKey]);
      expect(pending).toMatchObject({ key: tvKey, attempts: 1 });
      expect(pending.lastError).toContain('simulated storage failure');

      // 저장소가 복구되면 다음 실행이 지운다
      storage.failDeletes.delete(tvKey);
      const second = await assetJob.run();
      expect(storage.objects.has(tvKey)).toBe(false);
      expect(second!.filesDeleted).toBeGreaterThanOrEqual(1);
      expect(await queued([tvKey])).toEqual([]);
    });

    it('잠금을 얻지 못하면 행도 대기열도 건드리지 않는다', async () => {
      const unused = await insertAsset({ status: 'READY', ageMs: 4 * DAY });
      // 잠금을 다른 곳이 잡고 있으면 아무것도 지우거나 기록하지 않는다
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(1179207270::int, 2::int)`,
        );
        expect(await assetJob.run()).toBeNull();
      });
      expect(await exists(unused)).toBe(true);
      expect(await queued(variantKeysOf(unused))).toEqual([]);
      await db.delete(assets).where(eq(assets.id, unused));
    });
  });

  describe('idempotency 기록 정리', () => {
    it('보관 기간이 지난 기록만 지운다', async () => {
      const scope = `e2e:${randomUUID()}`;
      const now = Date.now();
      await db.insert(idempotencyKeys).values([
        {
          scope,
          key: 'expired',
          fingerprint: 'x',
          status: 'COMPLETED',
          lockedUntil: new Date(now - DAY),
          expiresAt: new Date(now - HOUR),
        },
        {
          scope,
          key: 'fresh',
          fingerprint: 'x',
          status: 'COMPLETED',
          lockedUntil: new Date(now),
          expiresAt: new Date(now + HOUR),
        },
      ]);

      // 스케줄러가 꺼져 있으면 지우지 않는다
      await app.get(SchedulerService).cleanupIdempotencyKeys();
      const keysLeft = async () =>
        (
          await db
            .select({ key: idempotencyKeys.key })
            .from(idempotencyKeys)
            .where(eq(idempotencyKeys.scope, scope))
        )
          .map((row) => row.key)
          .sort();
      expect(await keysLeft()).toEqual(['expired', 'fresh']);

      await db.transaction((tx) =>
        app.get(IdempotencyService).deleteExpired(tx, new Date()),
      );
      expect(await keysLeft()).toEqual(['fresh']);

      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.scope, scope));
    });
  });
});
