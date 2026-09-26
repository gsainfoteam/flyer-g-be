import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export type RequestWithId = Request & { requestId?: string };

// 앞단(ingress)이 붙여 준 값은 로그를 이어 보기 위해 그대로 쓴다.
// 헤더는 누구나 보낼 수 있으므로 로그를 오염시키지 않는 형식만 받는다.
const INBOUND_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function generateRequestId(): string {
  return `req_${randomBytes(12).toString('base64url')}`;
}

/**
 * 요청마다 requestId를 정해 request에 넣고 `x-request-id` 응답 헤더로 돌려준다.
 * 사용자 오류 화면에 표시되어 문의할 때 로그를 찾는 기준이 된다.
 */
export function assignRequestId(req: RequestWithId, res: Response): string {
  if (!req.requestId) {
    const inbound = req.headers[REQUEST_ID_HEADER];
    req.requestId =
      typeof inbound === 'string' && INBOUND_REQUEST_ID.test(inbound)
        ? inbound
        : generateRequestId();
  }
  if (!res.headersSent) {
    res.setHeader(REQUEST_ID_HEADER, req.requestId);
  }
  return req.requestId;
}

// 요청 처리 중 어디서든 requestId를 읽을 수 있게 한다(감사 로그 등). 인자로 계속 넘기지 않아도 된다.
const requestContext = new AsyncLocalStorage<{ requestId: string }>();

/** 지금 처리 중인 요청의 requestId. 요청 밖(배치 등)이면 undefined */
export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const requestId = assignRequestId(req, res);
    requestContext.run({ requestId }, next);
  }
}
