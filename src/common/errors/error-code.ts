/**
 * 오류 응답의 `code` 값. 프론트는 message가 아니라 이 값으로 분기하므로
 * 한 번 배포한 값은 바꾸지 않는다. 새 code를 추가하면 프론트에도 알린다.
 */
export const ErrorCode = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER_ERROR: 'SERVER_ERROR',
  /** 같은 Ziggle 공지로 이미 신청했다 (공지 하나에 신청 하나) */
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',
  /** 같은 Idempotency-Key를 다른 요청 내용으로 다시 보냈다 */
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 예외에 code가 없을 때 쓰는 기본값. 프론트 API 요구사항 1.2의 표와 같다. */
export function defaultCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 413:
      return ErrorCode.PAYLOAD_TOO_LARGE;
    case 422:
      return ErrorCode.VALIDATION_FAILED;
    case 429:
      return ErrorCode.RATE_LIMITED;
  }
  return status >= 500 ? ErrorCode.SERVER_ERROR : ErrorCode.INVALID_REQUEST;
}
