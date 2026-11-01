import { Transform } from 'class-transformer';

/** 쿼리의 `a,b,c`를 배열로 바꾼다. 비어 있으면 undefined(필터 없음)다. 값 검증은 뒤에 붙이는 데코레이터가 한다. */
export function CommaSeparated(): PropertyDecorator {
  return Transform(({ value }) =>
    typeof value === 'string' && value !== ''
      ? value.split(',').map((item) => item.trim())
      : undefined,
  );
}
