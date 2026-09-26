import { Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.js';

/**
 * 프론트(다른 도메인)에서 API를 부를 수 있게 CORS를 켠다.
 * 허용 목록에 없는 origin에는 CORS 헤더를 붙이지 않는다. 요청은 서버에서 그대로 처리되지만
 * 브라우저가 응답을 스크립트에 넘기지 않는다. 오류를 던지면 서버 로그만 더러워진다.
 */
export function setupCors(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);
  const allowed = new Set(config.get('CORS_ALLOWED_ORIGINS', { infer: true }));

  if (allowed.size === 0) {
    new Logger('Cors').warn(
      'CORS_ALLOWED_ORIGINS가 비어 있어 CORS를 켜지 않습니다. 다른 도메인의 프론트는 API를 부를 수 없습니다.',
    );
    return;
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      // Origin이 없는 요청(서버 간 호출, curl)은 CORS 대상이 아니다.
      callback(null, origin !== undefined && allowed.has(originOf(origin)));
    },
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'If-None-Match',
      'X-Device-Token',
      'X-Request-Id',
    ],
    // 스크립트가 읽어야 하는 응답 헤더. 브라우저는 기본으로 몇 개만 보여 준다.
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'ETag'],
    // 인증은 Bearer 토큰이라 쿠키를 보내지 않는다.
    credentials: false,
    // preflight 결과를 10분 캐시해 매 요청마다 OPTIONS를 보내지 않게 한다.
    maxAge: 600,
  });
}

function originOf(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return '';
  }
}
