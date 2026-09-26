import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { sha256Checksum } from '../src/assets/image-processor.js';
import { DB_CONNECTION, type Database } from '../src/db/index.js';
import { assets } from '../src/db/schema.js';
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
    await app.init();
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

      expect(res.body.fields).toEqual({
        mimeType: 'JPEG, PNG, WebP 파일만 올릴 수 있습니다.',
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

    it('해상도가 낮으면 422와 사유, 다시 불러도 같은 사유를 준다', async () => {
      const assetId = await uploaded(await poster(800, 1200));

      const res = await complete(assetId).expect(422);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: { file: '짧은 변이 1080px 이상이어야 합니다. (현재 800px)' },
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
  });
});
