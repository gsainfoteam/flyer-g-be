import {
  Module,
  ValidationPipe,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { validationExceptionFactory } from './errors/validation.js';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor.js';
import { IdempotencyService } from './idempotency/idempotency.service.js';
import { RequestIdMiddleware } from './request-id/request-id.js';

/**
 * 모든 API에 걸리는 공통 규칙(프론트 API 요구사항 1절).
 * main.ts가 아니라 모듈에 등록해 두어야 e2e 테스트의 앱에도 똑같이 적용된다.
 */
@Module({
  providers: [
    IdempotencyService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      // whitelist: DTO에 없는 필드는 잘라낸다.
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          transform: true,
          exceptionFactory: validationExceptionFactory,
        }),
    },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  // 만료 기록 정리는 스케줄러(src/jobs)가 한다.
  exports: [IdempotencyService],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
