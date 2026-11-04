import { z } from 'zod';
import { gameConfigSchema } from './games/index.js';

/**
 * 라이브 상태(FE 요청 3-1). 편성 위에 잠시 덮이는 것으로, 서버가 진실이다.
 * jsonb 컬럼(live_states.main·alert)과 PUT 입력이 이 스키마를 따른다.
 * 지금 시각에 따른 검사(until)는 서비스가 한다.
 */

/** GAME.until은 이보다 멀리 둘 수 없다(FE 7-3) */
export const MAX_GAME_DURATION_MS = 3 * 3600_000;
export const ALERT_TEXT_MAX = 80;

const strict = <Shape extends z.ZodRawShape>(shape: Shape, message: string) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `알 수 없는 항목이 있습니다: ${issue.keys.join(', ')}`
        : message,
  });

const untilSchema = z.iso.datetime({
  offset: true,
  error: '끝 시각은 시간대가 있는 ISO 시각이어야 합니다.',
});

const showSchema = strict(
  {
    action: z.literal('SHOW'),
    submissionId: z.uuid('신청 ID가 올바르지 않습니다.').nullish(),
    programId: z
      .string('운영 컨텐츠 ID가 올바르지 않습니다.')
      .min(1, '운영 컨텐츠 ID가 올바르지 않습니다.')
      .max(64, '운영 컨텐츠 ID가 올바르지 않습니다.')
      .nullish(),
    /** 없으면 직접 해제할 때까지 */
    until: untilSchema.nullish(),
  },
  '라이브 내용이 올바르지 않습니다.',
).refine((show) => !show.submissionId !== !show.programId, {
  message: 'submissionId와 programId 중 하나만 보내세요.',
  path: ['submissionId'],
});

const gameSchema = strict(
  {
    action: z.literal('GAME'),
    game: gameConfigSchema,
    /** 필수. 판이 끝난 때를 서버는 모르므로 정해진 시간에 내린다(FE 7-3) */
    until: untilSchema,
  },
  '라이브 내용이 올바르지 않습니다.',
);

export const liveMainSchema = z.discriminatedUnion(
  'action',
  [showSchema, gameSchema],
  { error: '라이브 종류가 올바르지 않습니다.' },
);
export type LiveMain = z.infer<typeof liveMainSchema>;

export const liveAlertSchema = strict(
  {
    text: z
      .string('알림 문구를 입력하세요.')
      .trim()
      .min(1, '알림 문구를 입력하세요.')
      .max(ALERT_TEXT_MAX, `알림 문구는 ${ALERT_TEXT_MAX}자 이하여야 합니다.`),
    until: untilSchema.nullish(),
  },
  '알림이 올바르지 않습니다.',
);
export type LiveAlert = z.infer<typeof liveAlertSchema>;

/** PUT 입력. 그 범위(기기·그룹)의 라이브를 통째로 바꾼다. 보내지 않거나 null이면 그 부분을 해제한다 */
export const liveInputSchema = strict(
  {
    main: liveMainSchema.nullable().default(null),
    alert: liveAlertSchema.nullable().default(null),
  },
  '라이브가 올바르지 않습니다.',
);
export type LiveInput = z.infer<typeof liveInputSchema>;
