import { z } from 'zod';
import { strictObject } from '../common/validation/zod.js';
import { PROGRAM_TYPES } from './program-types.js';

export const PROGRAM_NAME_MAX = 40;

const nameSchema = z
  .string('이름을 입력하세요.')
  .trim()
  .min(1, '이름을 입력하세요.')
  .max(PROGRAM_NAME_MAX, `이름은 ${PROGRAM_NAME_MAX}자까지입니다.`);

/** 만들기 본문. type마다 params 모양이 다르다(레지스트리의 params) */
export const createProgramSchema = z.discriminatedUnion(
  'type',
  PROGRAM_TYPES.map((definition) =>
    strictObject(
      {
        type: z.literal(definition.type),
        name: nameSchema,
        params: definition.params,
      },
      '운영 컨텐츠가 올바르지 않습니다.',
    ),
  ) as unknown as [z.ZodObject, ...z.ZodObject[]],
  {
    error: (issue) =>
      issue.code === 'invalid_union'
        ? `운영 컨텐츠 종류가 올바르지 않습니다. (${PROGRAM_TYPES.map((d) => d.type).join(', ')})`
        : undefined,
  },
);
export type CreateProgramInput = {
  type: string;
  name: string;
  params: Record<string, unknown>;
};

/** 고치기 본문. params는 그 운영 컨텐츠 종류의 모양으로 통째로 바꾼다. 종류는 바꿀 수 없다 */
export const updateProgramSchema = strictObject(
  {
    name: nameSchema.optional(),
    params: z.unknown().optional(),
  },
  '운영 컨텐츠가 올바르지 않습니다.',
);
export type UpdateProgramInput = z.output<typeof updateProgramSchema>;
