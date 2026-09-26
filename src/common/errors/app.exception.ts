import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ErrorCode } from './error-code.js';

/** 필드 경로 → 오류 문구. 프론트가 해당 입력 칸 아래에 붙인다. */
export type FieldErrors = Record<string, string>;

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
  ) {
    super({ code, message, fields }, status);
  }
}
