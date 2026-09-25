import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export const IDEMPOTENT_KEY = 'idempotent';
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

/**
 * 생성·제출·승인처럼 되돌리기 어려운 요청에 붙인다.
 * `Idempotency-Key` 헤더가 필수가 되고, 같은 key의 재시도는 처음 응답을 그대로 받는다.
 * 실제 처리는 전역 IdempotencyInterceptor가 한다.
 */
export function Idempotent() {
  return applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description: `시도 하나당 UUID 하나. 재시도에는 같은 값을 다시 쓴다.

- 같은 key로 이미 성공한 요청이면 처리하지 않고 처음 응답을 그대로 준다 (\`Idempotent-Replayed: true\` 헤더)
- 같은 key의 요청이 처리 중이면 끝날 때까지 기다렸다가 같은 응답을 준다. 너무 오래 걸리면 409 \`CONFLICT\`
- 같은 key로 내용이 다른 요청을 보내면 422 \`IDEMPOTENCY_KEY_REUSED\`
- 헤더가 없거나 형식이 틀리면 400 \`INVALID_REQUEST\`
- 실패한 요청은 기억하지 않는다. 같은 key로 다시 보내면 다시 처리한다`,
      schema: {
        type: 'string',
        example: '3f2a1c9e-7b5d-4e21-9a0c-1d8e5f6b2c34',
      },
    }),
  );
}
