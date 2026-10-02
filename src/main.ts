import {
  initializeMetrics,
  MetricsInterceptor,
  shutdownOpenTelemetry,
} from '@gsainfoteam/nest-observability';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { setupCors } from './config/cors.js';
import type { Env } from './config/env.js';
import { setupSwagger } from './config/swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 컨테이너가 종료 신호(SIGTERM)를 받으면 진행 중인 요청을 정리하고 내려간다.
  app.enableShutdownHooks();

  setupCors(app);
  setupSwagger(app);
  app.useGlobalInterceptors(new MetricsInterceptor());

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });

  let isShuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    const logger = new Logger('Bootstrap');
    let exitCode = 0;
    logger.log(`Received ${signal}. Starting graceful shutdown.`);

    void (async () => {
      try {
        await app.close();
      } catch (error) {
        exitCode = 1;
        logger.error('Failed to close Nest application', error);
      }

      try {
        await shutdownOpenTelemetry();
      } catch (error) {
        exitCode = 1;
        logger.error('Failed to shutdown OpenTelemetry', error);
      }

      process.exit(exitCode);
    })();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen(port, '0.0.0.0');
  console.log(`Server listening on port ${port}`);
}

const bootstrapWithOTEL = async () => {
  const logger = new Logger('Bootstrap');
  try {
    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'flyer-g-be';
    initializeMetrics(serviceName);
    await bootstrap();
  } catch (error) {
    logger.error('Failed to bootstrap application', error);
    process.exit(1);
  }
};

void bootstrapWithOTEL();
