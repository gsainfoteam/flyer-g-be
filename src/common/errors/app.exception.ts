import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ErrorCode } from './error-code.js';

/** 필드 경로 → 오류 문구. 프론트가 해당 입력 칸 아래에 붙인다. */
export type FieldErrors = Record<string, string>;

/** code마다 정해진 부가 정보. 프론트가 안내 문구를 만드는 데 쓴다 (예: DAILY_LIMIT_EXCEEDED의 { type, limit }) */
export type ErrorDetails = Record<string, unknown>;

/**
 * 기본 code(상태코드별) 대신 특정 code를 내려야 할 때 던진다.
 * 예: throw new AppException(409, ErrorCode.CONFLICT, 'Submission was modified')
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldErrors,
    readonly details?: ErrorDetails,
  ) {
    super({ code, message, fields, details }, status);
  }
}
