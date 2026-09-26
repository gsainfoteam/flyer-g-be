import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  HttpStatus,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../../auth/types/auth-user.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.js';
import { IdempotencyService } from './idempotency.service.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_KEY,
  IDEMPOTENT_REPLAYED_HEADER,
} from './idempotent.decorator.js';

const VALID_KEY = /^[\x21-\x7E]{1,255}$/;

/**
 * @Idempotent() 라우트의 전역 인터셉터.
 *
 * 1. (scope, key)를 선점한 요청만 핸들러를 실행하고 성공 응답을 저장한다.
 * 2. 이미 성공한 key면 저장된 응답을 돌려준다.
 * 3. 처리 중인 key면 끝날 때까지 기다린다. 더블 클릭처럼 거의 동시에 온 두 번째
 *    요청도 핸들러를 다시 실행하지 않고 첫 번째 결과를 받는다.
 *
 * 한계: 핸들러의 DB 쓰기와 응답 저장은 한 트랜잭션이 아니다. 핸들러 성공 직후
 * 파드가 죽으면 잠금 만료(30초) 뒤의 재시도가 다시 실행된다. 중복이 치명적인 곳은
 * DB unique 제약으로 한 번 더 막는다.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  // 테스트에서 줄여 쓸 수 있게 필드로 둔다.
  waitTimeoutMs = 10_000;
  pollIntervalMs = 100;

  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) {
      return next.handle();
    }
    return from(this.handle(context, next));
  }

  private async handle(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();

    const key = req.headers[IDEMPOTENCY_KEY_HEADER];
    if (typeof key !== 'string' || !VALID_KEY.test(key)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_REQUEST,
        'Idempotency-Key header is missing or malformed',
      );
    }
    // JwtAuthGuard가 먼저 돌아 request.user가 채워져 있다.
    const scope = req.user ? `user:${req.user.id}` : 'anonymous';
    const fingerprint = fingerprintOf(req);
    const deadline = Date.now() + this.waitTimeoutMs;

    for (;;) {
      const result = await this.store.claim(scope, key, fingerprint);
      switch (result.kind) {
        case 'claimed':
          return this.execute(scope, key, next);
        case 'completed':
          res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
          return result.body;
        case 'mismatch':
          throw new AppException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            ErrorCode.IDEMPOTENCY_KEY_REUSED,
            'Idempotency-Key was already used for a different request',
          );
        case 'in_progress':
          if (Date.now() >= deadline) {
            throw new AppException(
              HttpStatus.CONFLICT,
              ErrorCode.CONFLICT,
              'A request with the same Idempotency-Key is still in progress',
            );
          }
          await sleep(this.pollIntervalMs);
      }
    }
  }

  private async execute(
    scope: string,
    key: string,
    next: CallHandler,
  ): Promise<unknown> {
    let body: unknown;
    try {
      body = await lastValueFrom(next.handle(), { defaultValue: undefined });
    } catch (error) {
      await this.store.release(scope, key).catch((releaseError: unknown) => {
        this.logger.error('Failed to release idempotency key', releaseError);
      });
      throw error;
    }

    // 처리는 이미 끝났으므로 저장에 실패해도 응답은 준다. 잠금이 만료되면 재시도가 다시 실행된다.
    await this.store.complete(scope, key, body).catch((error: unknown) => {
      this.logger.error('Failed to store idempotent response', error);
    });
    return body;
  }
}

function fingerprintOf(req: AuthenticatedRequest): string {
  return createHash('sha256')
    .update(`${req.method} ${req.originalUrl}\n`)
    .update(JSON.stringify(req.body ?? null))
    .digest('hex');
}
