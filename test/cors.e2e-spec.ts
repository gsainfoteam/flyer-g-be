import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupCors } from '../src/config/cors.js';

// 허용 목록은 vitest.config.e2e.ts의 CORS_ALLOWED_ORIGINS
const ALLOWED = 'http://localhost:5173';
const ALLOWED_STG = 'https://stg.flyer-g.gistory.me';
const OTHER = 'https://evil.example';

describe('CORS (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupCors(app);
    // 파일 동안 포트를 하나로 고정한다. supertest가 요청마다 서버를 열고 닫으면
    // 동시 요청 중 하나가 닫힌 서버에 걸려 끊긴다(socket hang up).
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  const preflight = (origin: string, method: string, headers: string) =>
    request(app.getHttpServer())
      .options('/signage/submissions')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', method)
      .set('Access-Control-Request-Headers', headers);

  const splitHeader = (value: string | undefined) =>
    (value ?? '').split(',').map((part) => part.trim().toLowerCase());

  it('허용된 origin의 preflight에 메서드·헤더·캐시 시간을 준다', async () => {
    const res = await preflight(
      ALLOWED,
      'POST',
      'authorization,content-type,idempotency-key',
    ).expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(splitHeader(res.headers['access-control-allow-methods'])).toEqual(
      expect.arrayContaining(['get', 'post', 'patch']),
    );
    expect(splitHeader(res.headers['access-control-allow-headers'])).toEqual(
      expect.arrayContaining([
        'authorization',
        'content-type',
        'idempotency-key',
        'if-none-match',
        'x-device-token',
      ]),
    );
    expect(res.headers['access-control-max-age']).toBe('600');
    // 쿠키를 쓰지 않는다
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('실제 응답에 origin과 스크립트가 읽을 헤더 목록을 붙인다', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', ALLOWED_STG)
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_STG);
    expect(splitHeader(res.headers['access-control-expose-headers'])).toEqual(
      expect.arrayContaining(['x-request-id', 'idempotent-replayed', 'etag']),
    );
    // 캐시가 origin별로 다른 응답을 섞지 않도록
    expect(splitHeader(res.headers.vary)).toContain('origin');
  });

  it('허용 목록에 없는 origin에는 CORS 헤더를 붙이지 않는다', async () => {
    const pre = await preflight(OTHER, 'POST', 'authorization');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();

    // 서버는 요청을 처리하지만 브라우저가 응답을 스크립트에 넘기지 않는다
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', OTHER)
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('비슷한 도메인은 허용하지 않는다', async () => {
    for (const origin of [
      'https://stg.flyer-g.gistory.me.evil.example',
      'http://stg.flyer-g.gistory.me',
      'http://localhost:5174',
    ]) {
      const res = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('Origin이 없는 요청(서버 간 호출)은 CORS 대상이 아니다', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('인증이 필요한 API도 preflight는 인증 없이 통과한다', async () => {
    const res = await request(app.getHttpServer())
      .options('/signage/devices/3c1e9a7b-5b7d-4e21-9a0c-1d8e5f6b2c34/playlist')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-device-token,if-none-match')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });
});
