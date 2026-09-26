import { HttpStatus } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.js';

/**
 * cursor는 마지막 항목의 정렬 키를 JSON → base64url로 감싼 값이다.
 * 프론트는 해석하지 않고 그대로 돌려보낸다.
 * 사용자가 값을 조작해도 조회 권한 조건은 그대로 걸리므로 서명하지 않는다.
 */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** 형식이 틀린 cursor는 400으로 거절한다. */
export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  try {
    const json: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    const parsed = schema.safeParse(json);
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // 아래에서 공통으로 처리한다
  }
  throw new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.INVALID_REQUEST,
    'Invalid cursor',
    { cursor: '목록 위치 정보가 올바르지 않습니다. 처음부터 다시 불러오세요.' },
  );
}
