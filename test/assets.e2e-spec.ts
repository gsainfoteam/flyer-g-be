import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { variantKeysOf } from '../src/assets/asset-files.js';
import { sha256Checksum } from '../src/assets/image-processor.js';
import {
  MAX_PROCESSING_ATTEMPTS,
  VideoProcessingService,
} from '../src/assets/video-processing.service.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { assets, storageDeletions } from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import { MemoryStorage } from './helpers/memory-storage.js';
import { createTestUser, type TestUser } from './helpers/test-user.js';

async function poster(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: '#cc3366' },
  })
    .withMetadata({
      exif: {
        IFD0: { Make: 'TestCam' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 13/1 30/1' },
      },
    })
    .jpeg()
    .toBuffer();
}

describe('포스터 업로드 (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let storage: MemoryStorage;
  let owner: TestUser;
  let stranger: TestUser;

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
    owner = await createTestUser(app);
    stranger = await createTestUser(app);
  });

  afterAll(async () => {
    // 사용자를 지우면 asset도 함께 지워진다.
    await owner.remove();
    await stranger.remove();
    await app.close();
  });

  const presign = (body: object, user = owner) =>
    request(app.getHttpServer())
      .post('/signage/assets/presign')
      .set('Authorization', user.authHeader)
      .send(body);

  const complete = (assetId: string, user = owner) =>
    request(app.getHttpServer())
      .post(`/signage/assets/${assetId}/complete`)
      .set('Authorization', user.authHeader);

  /** presign → (브라우저 업로드 흉내) 까지 하고 assetId를 준다 */
  async function uploaded(bytes: Buffer, extra: object = {}) {
    const res = await presign({
      fileName: 'poster.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: bytes.length,
      ...extra,
    }).expect(201);
    storage.upload(`uploads/${res.body.assetId}`, bytes);
    return res.body.assetId as string;
  }

  describe('presign', () => {
    it('서명 URL과 업로드에 실을 헤더를 준다', async () => {
      const res = await presign({
        fileName: 'poster.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 3145728,
      }).expect(201);

      expect(res.body).toEqual({
        assetId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        uploadUrl: `memory://upload/uploads/${res.body.assetId}`,
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        expiresAt: expect.any(String),
      });
      const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(14 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);
    });

    it('10MB를 넘으면 413 PAYLOAD_TOO_LARGE와 한도 안내', async () => {
      const res = await presign({
        fileName: 'big.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10 * 1024 * 1024 + 1,
      }).expect(413);

      expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
      expect(res.body.fields).toEqual({
        sizeBytes: '파일은 10MB 이하여야 합니다.',
      });
    });

    it('허용하지 않는 형식은 422 필드 오류', async () => {
      const res = await presign({
        fileName: 'poster.svg',
        mimeType: 'image/svg+xml',
        sizeBytes: 1000,
      }).expect(422);

      // e2e는 영상 업로드를 켜고 돈다. 꺼진 경우의 안내는 signage-policy.spec.ts가 본다
      expect(res.body.fields).toEqual({
        mimeType:
          'JPEG, PNG, WebP 이미지나 MP4, MOV, WebM 영상만 올릴 수 있습니다.',
      });
    });

    it('로그인이 필요하다', async () => {
      await request(app.getHttpServer())
        .post('/signage/assets/presign')
        .send({})
        .expect(401);
    });
  });

  describe('complete', () => {
    it('검증 후 EXIF를 뺀 변형 이미지를 만들고 원본을 지운다', async () => {
      const bytes = await poster(1536, 2048);
      const assetId = await uploaded(bytes);

      const res = await complete(assetId).expect(200);

      const base = `https://cdn.test/assets/${assetId}`;
      expect(res.body).toEqual({
        assetId,
        status: 'READY',
        kind: 'IMAGE',
        url: `${base}/preview.webp`,
        mimeType: 'image/jpeg',
        width: 1536,
        height: 2048,
        sizeBytes: bytes.length,
        checksum: sha256Checksum(bytes),
        moderationStatus: 'APPROVED',
        variants: {
          thumb: `${base}/thumb.webp`,
          preview: `${base}/preview.webp`,
          tv: `${base}/tv.webp`,
        },
        videoUrl: null,
        durationMs: null,
        hasAudio: null,
      });

      expect(storage.objects.has(`uploads/${assetId}`)).toBe(false);
      for (const variant of ['thumb', 'preview', 'tv']) {
        const object = storage.objects.get(`assets/${assetId}/${variant}.webp`);
        expect(object?.contentType).toBe('image/webp');
        const meta = await sharp(object!.body).metadata();
        expect(meta.exif).toBeUndefined();
      }
    });

    it('여러 번 불러도 같은 결과를 준다', async () => {
      const assetId = await uploaded(await poster(1200, 1600));
      const first = await complete(assetId).expect(200);
      const second = await complete(assetId).expect(200);
      expect(second.body).toEqual(first.body);
    });

    it('신고한 checksum과 다르면 거절한다', async () => {
      const bytes = await poster(1200, 1600);
      const assetId = await uploaded(bytes, {
        checksum: sha256Checksum(Buffer.from('different')),
      });

      const res = await complete(assetId).expect(422);
      expect(res.body.fields.file).toContain('손상');
    });

    it('해상도가 낮아도 받는다', async () => {
      const assetId = await uploaded(await poster(400, 300));
      const res = await complete(assetId).expect(200);
      expect(res.body).toMatchObject({ width: 400, height: 300 });
    });

    it('거절하면 422와 사유, 다시 불러도 같은 사유를 준다', async () => {
      const gif = await sharp({
        create: {
          width: 1200,
          height: 1600,
          channels: 3,
          background: '#cc3366',
        },
      })
        .gif()
        .toBuffer();
      const assetId = await uploaded(gif);

      const res = await complete(assetId).expect(422);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: {
          file: '지원하지 않는 형식입니다. JPEG, PNG, WebP 파일만 올릴 수 있습니다.',
        },
      });

      const again = await complete(assetId).expect(422);
      expect(again.body.fields).toEqual(res.body.fields);

      expect(storage.objects.has(`uploads/${assetId}`)).toBe(false);
      const [row] = await db
        .select({ status: assets.status })
        .from(assets)
        .where(eq(assets.id, assetId));
      expect(row.status).toBe('REJECTED');
    });

    it('JPEG라고 신고해도 내용이 SVG면 거절한다', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"/>',
      );
      const assetId = await uploaded(svg);

      const res = await complete(assetId).expect(422);
      expect(res.body.fields.file).toContain('지원하지 않는 형식');
    });

    it('아직 올리지 않았으면 400이고, 올린 뒤에는 성공한다', async () => {
      const bytes = await poster(1200, 1600);
      const res = await presign({
        fileName: 'poster.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
      }).expect(201);
      const { assetId } = res.body;

      const early = await complete(assetId).expect(400);
      expect(early.body.code).toBe('INVALID_REQUEST');

      storage.upload(`uploads/${assetId}`, bytes);
      await complete(assetId).expect(200);
    });

    it('남의 asset은 404', async () => {
      const assetId = await uploaded(await poster(1200, 1600));
      const res = await complete(assetId, stranger).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('형식이 틀린 ID는 404', async () => {
      await complete('not-a-uuid').expect(404);
    });

    const queuedKeys = async (keys: string[]) =>
      (
        await db
          .select({ key: storageDeletions.key })
          .from(storageDeletions)
          .where(inArray(storageDeletions.key, keys))
      ).map((row) => row.key);

    it('원본 삭제가 실패해도 응답은 성공하고, 원본은 삭제 대기열에 들어간다', async () => {
      const assetId = await uploaded(await poster(1200, 1600));
      const original = `uploads/${assetId}`;
      storage.failDeletes.add(original);
      try {
        await complete(assetId).expect(200);
        expect(storage.objects.has(original)).toBe(true);
        expect(await queuedKeys([original])).toEqual([original]);
      } finally {
        storage.failDeletes.delete(original);
        await db
          .delete(storageDeletions)
          .where(eq(storageDeletions.key, original));
      }
    });

    it('처리 도중 정리 작업이 행을 지우면 404이고, 방금 올린 변형 이미지는 삭제 대기열에 들어간다', async () => {
      const assetId = await uploaded(await poster(1200, 1600));
      const variantKeys = ['thumb', 'preview', 'tv'].map(
        (variant) => `assets/${assetId}/${variant}.webp`,
      );
      storage.beforePut = async () => {
        storage.beforePut = undefined;
        await db.delete(assets).where(eq(assets.id, assetId));
      };
      try {
        await complete(assetId).expect(404);
        expect((await queuedKeys(variantKeys)).sort()).toEqual(
          [...variantKeys].sort(),
        );
      } finally {
        storage.beforePut = undefined;
        await db
          .delete(storageDeletions)
          .where(inArray(storageDeletions.key, variantKeysOf(assetId)));
      }
    });
  });

  describe('영상', () => {
    const exec = promisify(execFile);
    let videos: VideoProcessingService;
    let dir: string;

    beforeAll(async () => {
      videos = app.get(VideoProcessingService);
      dir = await mkdtemp(join(tmpdir(), 'assets-e2e-'));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    let seq = 0;
    /** ffmpeg로 만든 테스트 영상 (320x180, 소리 있음) */
    async function clip(seconds = 1): Promise<Buffer> {
      const path = join(dir, `clip-${++seq}.mp4`);
      // prettier-ignore
      await exec('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10',
        '-f', 'lavfi', '-i', 'sine=frequency=440',
        '-t', String(seconds),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        path,
      ]);
      return readFile(path);
    }

    async function uploadedVideo(bytes: Buffer): Promise<string> {
      const res = await presign({
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: bytes.length,
      }).expect(201);
      storage.upload(`uploads/${res.body.assetId}`, bytes, 'video/mp4');
      return res.body.assetId as string;
    }

    const rowOf = async (assetId: string) =>
      (await db.select().from(assets).where(eq(assets.id, assetId)))[0];

    /** 변환 대기열이 빌 때까지 처리한다. 일시적 실패는 한 번에 한 번만 다시 시도하므로 여러 번 부른다 */
    async function settle(assetId: string) {
      for (let i = 0; i <= MAX_PROCESSING_ATTEMPTS + 1; i++) {
        await videos.drain();
        if ((await rowOf(assetId)).status !== 'PROCESSING') {
          return;
        }
      }
    }

    it('100MB를 넘으면 413', async () => {
      const res = await presign({
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 100 * 1024 * 1024 + 1,
      }).expect(413);
      expect(res.body.fields).toEqual({
        sizeBytes: '파일은 100MB 이하여야 합니다.',
      });
    });

    it('202 PROCESSING과 Retry-After를 주고, 변환이 끝나면 200과 결과를 준다', async () => {
      const bytes = await clip();
      const assetId = await uploadedVideo(bytes);

      const first = await complete(assetId).expect(202);
      expect(first.headers['retry-after']).toBe('5');
      expect(first.body).toEqual({
        assetId,
        status: 'PROCESSING',
        kind: 'VIDEO',
        retryAfterSeconds: 5,
      });

      await settle(assetId);
      const res = await complete(assetId).expect(200);
      const base = `https://cdn.test/assets/${assetId}`;
      expect(res.body).toEqual({
        assetId,
        status: 'READY',
        kind: 'VIDEO',
        url: `${base}/preview.webp`,
        mimeType: 'video/mp4',
        width: 320,
        height: 180,
        sizeBytes: bytes.length,
        checksum: sha256Checksum(bytes),
        moderationStatus: 'APPROVED',
        variants: {
          thumb: `${base}/thumb.webp`,
          preview: `${base}/preview.webp`,
          tv: `${base}/tv.webp`,
        },
        videoUrl: `${base}/video.mp4`,
        durationMs: expect.any(Number),
        hasAudio: true,
      });
      expect(res.body.durationMs).toBeGreaterThan(900);

      expect(storage.objects.has(`uploads/${assetId}`)).toBe(false);
      expect(
        storage.objects.get(`assets/${assetId}/video.mp4`)?.contentType,
      ).toBe('video/mp4');
      const poster = storage.objects.get(`assets/${assetId}/tv.webp`)!;
      expect((await sharp(poster.body).metadata()).format).toBe('webp');
    });

    it('정책을 넘으면 422와 사유, 다시 불러도 같은 사유를 준다', async () => {
      const assetId = await uploadedVideo(await clip(31));
      await complete(assetId).expect(202);
      await settle(assetId);

      const res = await complete(assetId).expect(422);
      expect(res.body.fields.file).toMatch(
        /^영상은 30초 이하여야 합니다\. \(현재 3\d\.\d초\)$/,
      );
      const again = await complete(assetId).expect(422);
      expect(again.body.fields).toEqual(res.body.fields);
      expect(storage.objects.has(`uploads/${assetId}`)).toBe(false);
    });

    it('영상이라고 신고해도 내용이 이미지면 거절한다', async () => {
      const assetId = await uploadedVideo(await poster(1200, 1600));
      await complete(assetId).expect(202);
      await settle(assetId);

      const res = await complete(assetId).expect(422);
      expect(res.body.fields.file).toContain('지원하지 않는 형식');
    });

    it('저장소 장애는 다시 시도하고, 계속 실패하면 거절한다', async () => {
      const assetId = await uploadedVideo(await clip());
      storage.failDownloads.add(`uploads/${assetId}`);
      try {
        await complete(assetId).expect(202);
        await videos.drain();
        // 한 번 실패해도 대기열에 남는다. 다음 주기가 다시 가져가도록 잡은 것을 놓았다
        const afterFailure = await rowOf(assetId);
        expect(afterFailure.status).toBe('PROCESSING');
        expect(afterFailure.processingStartedAt).toBeNull();
        await complete(assetId).expect(202);

        await settle(assetId);
        const row = await rowOf(assetId);
        expect(row.status).toBe('REJECTED');
        expect(row.processingAttempts).toBe(MAX_PROCESSING_ATTEMPTS + 1);
        const res = await complete(assetId).expect(422);
        expect(res.body.fields.file).toBe(
          '영상을 처리하지 못했습니다. 잠시 후 다시 올려주세요.',
        );
      } finally {
        storage.failDownloads.delete(`uploads/${assetId}`);
      }
    });

    it('다른 파드가 처리 중인 것은 두고, 멈춘 것은 다시 가져간다', async () => {
      const assetId = await uploadedVideo(await clip());
      // complete를 거치지 않고 "다른 파드가 막 가져간" 상태를 만든다 (같은 파드가 바로 처리하지 않게)
      await db
        .update(assets)
        .set({ status: 'PROCESSING', processingStartedAt: new Date() })
        .where(eq(assets.id, assetId));
      await videos.drain();
      expect((await rowOf(assetId)).status).toBe('PROCESSING');

      // 그 파드가 죽어 오래 잡혀 있었다
      await db
        .update(assets)
        .set({ processingStartedAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(assets.id, assetId));
      await videos.drain();
      expect((await rowOf(assetId)).status).toBe('READY');
    });
  });
});
