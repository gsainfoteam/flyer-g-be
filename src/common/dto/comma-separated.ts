import { Transform } from 'class-transformer';

/**
 * 쿼리의 `a,b,c`를 배열로 바꾼다. 비어 있으면 undefined(필터 없음)다. 값 검증은 뒤에 붙이는 데코레이터가 한다.
 * `?k=a&k=b,c`처럼 키가 반복되면 Express가 배열로 넘기므로, 각 값을 나눠 이어 붙인다.
 */
export function CommaSeparated(): PropertyDecorator {
  return Transform(({ value }) => {
    if (value === undefined || value === '') {
      return undefined;
    }
    const parts: unknown[] = Array.isArray(value) ? value : [value];
    return parts.flatMap((part) =>
      typeof part === 'string'
        ? part.split(',').map((item) => item.trim())
        : [part],
    );
  });
}
