import { z } from 'zod';
import { strictObject } from '../../common/validation/zod.js';
import type { ProgramType } from '../program-type.js';
import { dateSchema, ddayStatus, labelSchema } from './dday.program.js';

const params = strictObject(
  {
    label: labelSchema('시험 이름'),
    date: dateSchema('시험 날짜'),
    message: z
      .string('응원 문구는 글자여야 합니다.')
      .trim()
      .max(40, '응원 문구는 40자까지입니다.')
      .nullish()
      .transform((value) => value || null)
      .meta({ title: '응원 문구' }),
  },
  '시험 응원 설정이 올바르지 않습니다.',
);

/** 시험 응원. 시험 이름·날짜와 응원 문구를 띄운다. 문구가 없으면 TV가 기본 문구를 쓴다 */
export const EXAM_CHEER_PROGRAM: ProgramType<z.output<typeof params>> = {
  type: 'EXAM_CHEER',
  name: '시험 응원',
  defaultDurationSeconds: 8,
  params,
  dataSource: 'NONE',
  dataStatus: (value, { now }) => ddayStatus(value.date, now),
};
