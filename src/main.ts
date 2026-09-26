import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { setupSwagger } from './config/swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 컨테이너가 종료 신호(SIGTERM)를 받으면 진행 중인 요청을 정리하고 내려간다.
  app.enableShutdownHooks();

  setupSwagger(app);

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });

  await app.listen(port, '0.0.0.0');
  console.log(`Server listening on port ${port}`);
}

await bootstrap();
