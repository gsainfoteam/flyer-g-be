import { HttpStatus, type ValidationError } from '@nestjs/common';
import { AppException, type FieldErrors } from './app.exception.js';
import { ErrorCode } from './error-code.js';

/**
 * ValidationPipe의 exceptionFactory. DTO 검증 실패를 422 + 필드별 오류로 바꾼다.
 * 필드 문구는 프론트 입력 칸에 그대로 붙으므로 DTO의 검증 데코레이터에
 * 한국어 message를 달아 두는 것이 좋다.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): AppException {
  return validationFailed(flattenValidationErrors(errors));
}

/** 서비스에서 DB 조회가 필요한 검증(존재 여부 등)에 실패했을 때도 같은 형태로 준다. */
export function validationFailed(fields: FieldErrors): AppException {
  return new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.VALIDATION_FAILED,
    '입력값이 올바르지 않습니다.',
    fields,
  );
}

/**
 * 중첩 DTO의 오류를 `resolution.width`, `targetGroupIds.0` 같은 점 경로로 편다.
 * 한 필드에 제약이 여러 개 걸리면 첫 번째 문구만 쓴다.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldErrors {
  const fields: FieldErrors = {};

  for (const error of errors) {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const [firstMessage] = Object.values(error.constraints ?? {});
    if (firstMessage) {
      fields[path] = firstMessage;
    }
    if (error.children?.length) {
      Object.assign(fields, flattenValidationErrors(error.children, path));
    }
  }

  return fields;
}
