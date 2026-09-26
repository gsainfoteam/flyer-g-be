import { NotFound, S3ServiceException } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { S3StorageService } from './s3-storage.service.js';

const settings: Partial<Env> = {
  AWS_S3_REGION: 'ap-northeast-2',
  AWS_S3_BUCKET: 'flyer-g-test',
  AWS_ACCESS_KEY_ID: 'test-access-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret-key',
};

const config = {
  get: (key: keyof Env) => settings[key],
} as unknown as ConfigService<Env, true>;

describe('S3StorageService', () => {
  const storage = new S3StorageService(config);

  afterAll(() => storage.onModuleDestroy());

  it('서명 URL은 Content-Type과 Content-Length를 서명에 포함한다', async () => {
    const url = new URL(
      await storage.presignPut('uploads/asset-1', {
        contentType: 'image/jpeg',
        contentLength: 3145728,
        expiresInSeconds: 900,
      }),
    );

    expect(url.origin + url.pathname).toBe(
      'https://flyer-g-test.s3.ap-northeast-2.amazonaws.com/uploads/asset-1',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'host']),
    );
    // 기본 체크섬이 끼면 브라우저가 올린 파일과 맞지 않아 업로드가 거절된다
    expect(url.search).not.toContain('x-amz-checksum');
    expect(url.search).not.toContain('x-amz-sdk-checksum');
  });

  it('공개 URL은 버킷의 virtual-hosted 주소다', () => {
    expect(storage.publicUrl('assets/asset-1/tv.webp')).toBe(
      'https://flyer-g-test.s3.ap-northeast-2.amazonaws.com/assets/asset-1/tv.webp',
    );
  });

  describe('sizeOf', () => {
    const send = () =>
      vi.spyOn(
        (storage as unknown as { client: { send: () => unknown } }).client,
        'send',
      );

    afterEach(() => vi.restoreAllMocks());

    function s3Error(name: string, httpStatusCode: number) {
      return new S3ServiceException({
        name,
        $fault: 'client',
        $metadata: { httpStatusCode },
      });
    }

    it('객체 크기를 준다', async () => {
      send().mockResolvedValue({ ContentLength: 2048 } as never);
      await expect(storage.sizeOf('uploads/a')).resolves.toBe(2048);
    });

    it('404면 null', async () => {
      send().mockRejectedValue(
        new NotFound({
          message: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        }),
      );
      await expect(storage.sizeOf('uploads/a')).resolves.toBeNull();
    });

    it('ListBucket 권한이 없어 403이 와도 없는 것으로 본다', async () => {
      send().mockRejectedValue(s3Error('Forbidden', 403));
      await expect(storage.sizeOf('uploads/a')).resolves.toBeNull();
    });

    it('그 밖의 오류는 그대로 던진다', async () => {
      send().mockRejectedValue(s3Error('InternalError', 500));
      await expect(storage.sizeOf('uploads/a')).rejects.toThrow();
    });
  });
});
