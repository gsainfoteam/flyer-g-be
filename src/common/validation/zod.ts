import type { PipeTransform } from '@nestjs/common';
import type { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';
import type { FieldErrors } from '../errors/app.exception.js';
import { validationFailed } from '../errors/validation.js';

/**
 * zod로 검증하고, 실패하면 class-validator DTO와 같은 422 + 점 경로 필드 오류를 준다.
 * prefix는 바깥 DTO 안에서 검증할 때의 필드 이름이다(예: 'overrides').
 */
export function parseOrFail<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  prefix?: string,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const fields: FieldErrors = {};
  for (const issue of result.error.issues) {
    const path = [prefix, ...issue.path.map(String)]
      .filter((part) => part !== undefined)
      .join('.');
    // class-validator와 같이 한 필드에는 첫 문구만 둔다
    fields[path || 'body'] ??= issue.message;
  }
  throw validationFailed(fields);
}

/**
 * 모르는 키를 받지 않는 객체. 모르는 키면 그 키 이름을, 그 밖의 모양 오류면 message를 준다.
 */
export const strictObject = <Shape extends z.ZodRawShape>(
  shape: Shape,
  message: string,
) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `알 수 없는 항목이 있습니다: ${issue.keys.join(', ')}`
        : message,
  });

/**
 * zod 스키마로 본문을 검증하는 파이프. 파라미터 타입을 클래스가 아닌 타입으로 두면
 * 전역 ValidationPipe는 건너뛰고 이 파이프만 검증한다.
 */
export class ZodBody<Schema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.output<Schema> {
    return parseOrFail(this.schema, value);
  }
}

type SchemaObject = Extract<
  Parameters<typeof ApiBody>[0],
  { schema: unknown }
>['schema'];

/** Swagger 문서용 스키마. 입력은 기본값이 있는 필드를 선택으로, 응답은 필수로 적는다. */
export function openApiOf(
  schema: z.ZodType,
  io: 'input' | 'output',
): SchemaObject {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as SchemaObject;
}
