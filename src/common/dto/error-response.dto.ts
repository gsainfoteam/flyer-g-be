import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode } from '../errors/error-code.js';

/** 모든 오류 응답의 형태 (src/common/errors/all-exceptions.filter.ts) */
export class ErrorResponseDto {
  @ApiProperty({
    description: `안정적인 오류 식별자. 프론트는 이 값으로 분기한다.

| 상태 | 기본 code |
|---|---|
| 400 | INVALID_REQUEST |
| 401 | UNAUTHENTICATED |
| 403 | FORBIDDEN |
| 404 | NOT_FOUND |
| 409 | CONFLICT |
| 413 | PAYLOAD_TOO_LARGE |
| 422 | VALIDATION_FAILED, IDEMPOTENCY_KEY_REUSED |
| 429 | RATE_LIMITED |
| 5xx | SERVER_ERROR |`,
    enum: Object.values(ErrorCode),
    example: ErrorCode.VALIDATION_FAILED,
  })
  code: ErrorCode;

  @ApiProperty({
    description: '디버깅용 설명. 화면에 그대로 노출하지 않는다',
    example: '입력값이 올바르지 않습니다.',
  })
  message: string;

  @ApiProperty({
    description:
      '요청 추적 ID. `x-request-id` 응답 헤더와 같은 값이다. 문의할 때 이 값으로 로그를 찾는다',
    example: 'req_Xk3p7QaZ1bN9vT2c',
  })
  requestId: string;

  @ApiPropertyOptional({
    description:
      '필드 경로별 오류 문구. 입력 검증 실패(422 VALIDATION_FAILED)일 때 온다. 중첩 필드는 `a.b`, 배열은 `a.0` 형식',
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { endAt: '종료 시각은 시작 시각보다 뒤여야 합니다.' },
  })
  fields?: Record<string, string>;
}
