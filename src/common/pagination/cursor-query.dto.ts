import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 10;
export const MAX_PAGE_LIMIT = 100;

// 프론트는 첫 페이지를 `cursor=&limit=10`처럼 빈 값으로 보낸다. 빈 값은 없는 것으로 본다.
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

/** 목록 쿼리의 cursor 필드 */
export function CursorField() {
  return applyDecorators(
    ApiPropertyOptional({
      description: '이전 응답의 nextCursor. 첫 페이지는 비운다',
      example: 'WyIyMDI2LTA3LTI5VDA2OjMwOjAwLjAwMFoiLCJzdWJfMDEiXQ',
    }),
    Transform(emptyToUndefined),
    IsOptional(),
    IsString(),
    IsNotEmpty(),
    MaxLength(512),
  );
}

/** 목록 쿼리의 limit 필드. 목록마다 기본값이 다를 수 있다(요구사항: 신청 10, 검토 20). */
export function LimitField(defaultLimit = DEFAULT_PAGE_LIMIT) {
  return applyDecorators(
    ApiPropertyOptional({
      description: '한 페이지 항목 수',
      minimum: 1,
      maximum: MAX_PAGE_LIMIT,
      default: defaultLimit,
    }),
    Transform(({ value }) => {
      const present = emptyToUndefined({ value });
      return present === undefined ? defaultLimit : Number(present);
    }),
    IsInt({ message: 'limit은 정수여야 합니다.' }),
    Min(1, { message: 'limit은 1 이상이어야 합니다.' }),
    Max(MAX_PAGE_LIMIT, {
      message: `limit은 ${MAX_PAGE_LIMIT} 이하여야 합니다.`,
    }),
  );
}

/** 목록 API 쿼리의 공통 부분. 목록별 필터 DTO가 상속한다. */
export class CursorQueryDto {
  @CursorField()
  cursor?: string;

  @LimitField()
  limit: number = DEFAULT_PAGE_LIMIT;
}
