import { timingSafeEqual } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from './env.js';

export const SWAGGER_PATH = 'docs';
/** @ApiBearerAuth(BEARER_AUTH)로 참조하는 보안 스키마 이름 */
export const BEARER_AUTH = 'bearerAuth';

/**
 * Swagger UI는 /docs, OpenAPI JSON은 /docs-json 에서 제공한다.
 * 라우트가 컨트롤러가 아니라 express에 직접 붙으므로 전역 JwtAuthGuard를 타지 않는다.
 * SWAGGER_USER / SWAGGER_PASSWORD를 설정하면 Basic Auth로 잠근다(chatbot-be와 동일).
 */
export function setupSwagger(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);
  const user = config.get('SWAGGER_USER', { infer: true });
  const password = config.get('SWAGGER_PASSWORD', { infer: true });

  if (user && password) {
    app.use(
      [`/${SWAGGER_PATH}`, `/${SWAGGER_PATH}-json`],
      basicAuth(user, password),
    );
  }

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Flyer-G API')
      .setDescription('Flyer-G 디지털 사이니지 게시 신청·편성 백엔드 API')
      .setVersion('0.0.1')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'POST /auth/login 으로 발급받은 accessToken',
        },
        BEARER_AUTH,
      )
      .build(),
  );

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

function basicAuth(user: string, password: string) {
  const expected = Buffer.from(`${user}:${password}`);

  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Basic ')
      ? Buffer.from(header.slice(6), 'base64')
      : Buffer.alloc(0);

    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      return next();
    }
    res
      .status(401)
      .setHeader('WWW-Authenticate', 'Basic realm="API Docs"')
      .send('Unauthorized');
  };
}
