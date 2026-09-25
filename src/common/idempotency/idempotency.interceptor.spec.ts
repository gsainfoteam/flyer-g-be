import { setTimeout as sleep } from 'node:timers/promises';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defer, lastValueFrom } from 'rxjs';
import { AppException } from '../errors/app.exception.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import type { ClaimResult, IdempotencyService } from './idempotency.service.js';

/** IdempotencyService와 같은 규칙을 메모리로 흉내 낸다. */
class FakeStore {
  records = new Map<
    string,
    { fingerprint: string; status: 'IN_PROGRESS' | 'COMPLETED'; body?: unknown }
  >();

  async claim(
    scope: string,
    key: string,
    fingerprint: string,
  ): Promise<ClaimResult> {
    const id = `${scope}/${key}`;
    const existing = this.records.get(id);
    if (!existing) {
      this.records.set(id, { fingerprint, status: 'IN_PROGRESS' });
      return { kind: 'claimed' };
    }
    if (existing.fingerprint !== fingerprint) return { kind: 'mismatch' };
    if (existing.status === 'COMPLETED') {
      return { kind: 'completed', body: existing.body };
    }
    return { kind: 'in_progress' };
  }

  async complete(scope: string, key: string, body: unknown) {
    const record = this.records.get(`${scope}/${key}`)!;
    record.status = 'COMPLETED';
    record.body = JSON.parse(JSON.stringify(body ?? null));
  }

  async release(scope: string, key: string) {
    this.records.delete(`${scope}/${key}`);
  }
}

type FakeRequest = {
  method: string;
  originalUrl: string;
  body: unknown;
  headers: Record<string, string>;
  user?: { id: string };
};

function contextFor(req: FakeRequest, res = { setHeader: vi.fn() }) {
  return {
    context: {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext,
    res,
  };
}

function request(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    method: 'POST',
    originalUrl: '/signage/submissions',
    body: { title: '공연' },
    headers: { 'idempotency-key': '3f2a1c9e-7b5d-4e21-9a0c-1d8e5f6b2c34' },
    user: { id: 'user-1' },
    ...overrides,
  };
}

describe('IdempotencyInterceptor', () => {
  let store: FakeStore;
  let reflector: Reflector;
  let interceptor: IdempotencyInterceptor;
  let handlerCalls: number;

  /** 50ms 걸리는 핸들러. 호출 횟수를 센다 */
  const slowHandler: CallHandler = {
    handle: () =>
      defer(async () => {
        handlerCalls += 1;
        await sleep(50);
        return { id: `sub_${handlerCalls}` };
      }),
  };

  function run(req: FakeRequest, handler: CallHandler = slowHandler) {
    const { context, res } = contextFor(req);
    return {
      result: lastValueFrom(interceptor.intercept(context, handler)),
      res,
    };
  }

  beforeEach(() => {
    store = new FakeStore();
    reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    interceptor = new IdempotencyInterceptor(
      reflector,
      store as unknown as IdempotencyService,
    );
    interceptor.pollIntervalMs = 5;
    handlerCalls = 0;
  });

  it('@Idempotent()가 없으면 헤더 없이도 그대로 통과한다', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const { result } = run(request({ headers: {} }));
    await expect(result).resolves.toEqual({ id: 'sub_1' });
  });

  it('헤더가 없으면 400', async () => {
    const { result } = run(request({ headers: {} }));
    await expect(result).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    });
    expect(handlerCalls).toBe(0);
  });

  it('완료된 key로 다시 보내면 핸들러를 실행하지 않고 처음 응답을 준다', async () => {
    await run(request()).result;
    const replay = run(request());

    await expect(replay.result).resolves.toEqual({ id: 'sub_1' });
    expect(handlerCalls).toBe(1);
    expect(replay.res.setHeader).toHaveBeenCalledWith(
      'idempotent-replayed',
      'true',
    );
  });

  it('동시에 온 같은 key의 요청은 하나만 실행하고 둘 다 같은 응답을 받는다', async () => {
    const results = await Promise.all([
      run(request()).result,
      run(request()).result,
    ]);

    expect(handlerCalls).toBe(1);
    expect(results).toEqual([{ id: 'sub_1' }, { id: 'sub_1' }]);
  });

  it('같은 key라도 사용자가 다르면 따로 처리한다', async () => {
    await run(request({ user: { id: 'user-1' } })).result;
    await run(request({ user: { id: 'user-2' } })).result;
    expect(handlerCalls).toBe(2);
  });

  it('같은 key로 내용이 다른 요청을 보내면 422 IDEMPOTENCY_KEY_REUSED', async () => {
    await run(request()).result;
    const { result } = run(request({ body: { title: '다른 공연' } }));

    await expect(result).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 422,
    });
  });

  it('핸들러가 실패하면 key를 풀어 같은 key로 다시 시도할 수 있다', async () => {
    const failing: CallHandler = {
      handle: () =>
        defer(async () => {
          handlerCalls += 1;
          throw new AppException(409, 'CONFLICT', 'Conflict');
        }),
    };

    await expect(run(request(), failing).result).rejects.toBeInstanceOf(
      AppException,
    );
    await expect(run(request()).result).resolves.toEqual({ id: 'sub_2' });
    expect(handlerCalls).toBe(2);
  });

  it('처리 중인 요청이 대기 시간 안에 끝나지 않으면 409', async () => {
    interceptor.waitTimeoutMs = 20;
    const neverEnding: CallHandler = {
      handle: () => defer(() => new Promise(() => undefined)),
    };

    void run(request(), neverEnding).result;
    await sleep(5);
    await expect(run(request()).result).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });
});
