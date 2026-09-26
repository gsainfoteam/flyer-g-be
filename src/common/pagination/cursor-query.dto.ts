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

/** 목록 API 쿼리의 공통 부분. 목록별 필터 DTO가 상속한다. */
export class CursorQueryDto {
  @ApiPropertyOptional({
    description: '이전 응답의 nextCursor. 첫 페이지는 비운다',
    example: 'WyIyMDI2LTA3LTI5VDA2OjMwOjAwLjAwMFoiLCJzdWJfMDEiXQ',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({
    description: '한 페이지 항목 수',
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @Transform(({ value }) => {
    const present = emptyToUndefined({ value });
    return present === undefined ? DEFAULT_PAGE_LIMIT : Number(present);
  })
  @IsInt({ message: 'limit은 정수여야 합니다.' })
  @Min(1, { message: 'limit은 1 이상이어야 합니다.' })
  @Max(MAX_PAGE_LIMIT, {
    message: `limit은 ${MAX_PAGE_LIMIT} 이하여야 합니다.`,
  })
  limit: number = DEFAULT_PAGE_LIMIT;
}
