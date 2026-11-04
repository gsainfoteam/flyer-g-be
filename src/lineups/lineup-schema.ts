import { z } from 'zod';
import { submissionTypeEnum, type SubmissionType } from '../db/schema.js';

/**
 * 그룹 편성과 기기 예외의 모양. jsonb 컬럼(group_lineups.settings, lineup_blocks.schedule,
 * devices.lineup_overrides)과 API 입력이 모두 이 스키마 하나를 따른다.
 * Swagger 문서도 여기서 만든다(lineup-docs.ts).
 */

export const POSTER_LAYOUTS = ['WALL', 'STRIP'] as const;
export type PosterLayout = (typeof POSTER_LAYOUTS)[number];

export const ROTATION_SECONDS_RANGE = { min: 5, max: 60 } as const;
export const REFRESH_SECONDS_RANGE = { min: 15, max: 300 } as const;
export const BLOCK_DURATION_RANGE = { min: 5, max: 300 } as const;
export const PER_VISIT_RANGE = { min: 1, max: 10 } as const;
export const MAX_BLOCKS = 30;
export const MAX_INFO_BAR_ENTRIES = 4;
export const MAX_QUIET_HOURS = 4;
export const MAX_SCHEDULE_WINDOWS = 8;

/** 블록에 perVisit을 보내지 않았을 때 한 번에 보여 줄 건수 (FE 요청 2-2) */
export const DEFAULT_PER_VISIT: Record<SubmissionType, number> = {
  POSTER: 3,
  EVENT_BANNER: 1,
  STORY: 2,
};

/** subject는 조사까지 붙인 이름이다(예: '전환 간격은'). */
const intIn = (
  range: { min: number; max: number },
  subject: string,
  unit: string,
) =>
  z
    .int(`${subject} 정수여야 합니다.`)
    .min(range.min, `${subject} ${range.min}${unit} 이상이어야 합니다.`)
    .max(range.max, `${subject} ${range.max}${unit} 이하여야 합니다.`);

/** 모르는 키를 받지 않는 객체. 모르는 키는 그 이름을 알려 준다. */
const strict = <Shape extends z.ZodRawShape>(shape: Shape, message: string) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `알 수 없는 항목이 있습니다: ${issue.keys.join(', ')}`
        : message,
  });

const unique = <T>(items: T[]) => new Set(items).size === items.length;

/** 서울 시각 `HH:mm` */
const clockSchema = z
  .string('시각은 HH:mm 형식이어야 합니다.')
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시각은 HH:mm 형식이어야 합니다.');

/** end가 start보다 이르면 자정을 넘는 구간이다(22:00–06:00). 같은 시각은 받지 않는다. */
const timeRangeShape = { start: clockSchema, end: clockSchema };
const distinctEnds = {
  check: (range: { start: string; end: string }) => range.start !== range.end,
  params: { message: '시작과 끝 시각이 같을 수 없습니다.', path: ['end'] },
};

const timeRangeSchema = strict(
  timeRangeShape,
  '시간 구간이 올바르지 않습니다.',
).refine(distinctEnds.check, distinctEnds.params);

const programIdSchema = z
  .string('운영 컨텐츠를 고르세요.')
  .min(1, '운영 컨텐츠를 고르세요.')
  .max(64, '운영 컨텐츠를 고르세요.');

/** 정보줄 한 칸. 쓸 수 있는 item은 운영 컨텐츠 종류가 정한다(⑩ 전에는 없다). */
const infoBarEntrySchema = strict(
  {
    item: z
      .string('정보줄 항목이 올바르지 않습니다.')
      .regex(/^[A-Z][A-Z0-9_]{0,31}$/, '정보줄 항목이 올바르지 않습니다.'),
    programId: programIdSchema,
  },
  '정보줄 항목이 올바르지 않습니다.',
);

export const lineupSettingsSchema = strict(
  {
    posterLayout: z.enum(
      POSTER_LAYOUTS,
      '포스터 화면 방식이 올바르지 않습니다.',
    ),
    rotationSeconds: intIn(ROTATION_SECONDS_RANGE, '전환 간격은', '초'),
    refreshAfterSeconds: intIn(REFRESH_SECONDS_RANGE, '갱신 주기는', '초'),
    infoBar: z
      .array(infoBarEntrySchema, '정보줄이 올바르지 않습니다.')
      .max(
        MAX_INFO_BAR_ENTRIES,
        `정보줄은 ${MAX_INFO_BAR_ENTRIES}칸까지입니다.`,
      )
      .refine(
        (entries) => unique(entries.map((entry) => entry.item)),
        '같은 정보줄 항목은 한 번만 넣을 수 있습니다.',
      ),
    quietHours: z
      .array(timeRangeSchema, '화면 끔 시간이 올바르지 않습니다.')
      .max(MAX_QUIET_HOURS, `화면 끔 시간은 ${MAX_QUIET_HOURS}개까지입니다.`),
  },
  '편성 설정이 올바르지 않습니다.',
);
export type LineupSettings = z.infer<typeof lineupSettingsSchema>;

export const DEFAULT_LINEUP_SETTINGS: LineupSettings = {
  posterLayout: 'WALL',
  rotationSeconds: 10,
  refreshAfterSeconds: 60,
  infoBar: [],
  quietHours: [],
};

const dayMessage = '요일은 1(월)~7(일)이어야 합니다.';
const windowSchema = strict(
  {
    days: z
      .array(
        z.int(dayMessage).min(1, dayMessage).max(7, dayMessage),
        dayMessage,
      )
      .min(1, '요일을 고르세요.')
      .refine(unique, '같은 요일을 두 번 고를 수 없습니다.'),
    ...timeRangeShape,
  },
  '시간대가 올바르지 않습니다.',
).refine(distinctEnds.check, distinctEnds.params);

const datetimeSchema = (message: string) =>
  z.iso.datetime({ offset: true, error: message });

/** 블록이 나오는 때. 시각·요일은 서울 기준이고, TV가 오프라인에서도 스스로 판정한다. */
export const blockScheduleSchema = z.discriminatedUnion(
  'type',
  [
    strict({ type: z.literal('ALWAYS') }, '노출 일정이 올바르지 않습니다.'),
    strict(
      {
        type: z.literal('WINDOWS'),
        windows: z
          .array(windowSchema, '시간대를 넣으세요.')
          .min(1, '시간대를 넣으세요.')
          .max(
            MAX_SCHEDULE_WINDOWS,
            `시간대는 ${MAX_SCHEDULE_WINDOWS}개까지입니다.`,
          ),
      },
      '노출 일정이 올바르지 않습니다.',
    ),
    strict(
      {
        type: z.literal('DATE_RANGE'),
        from: datetimeSchema('시작 시각이 올바르지 않습니다.'),
        to: datetimeSchema('끝 시각이 올바르지 않습니다.'),
      },
      '노출 일정이 올바르지 않습니다.',
    ).refine((range) => Date.parse(range.from) < Date.parse(range.to), {
      message: '끝 시각은 시작 시각보다 뒤여야 합니다.',
      path: ['to'],
    }),
  ],
  { error: '노출 일정 종류가 올바르지 않습니다.' },
);
export type BlockSchedule = z.infer<typeof blockScheduleSchema>;

const blockIdSchema = z
  .string('블록 ID가 올바르지 않습니다.')
  .regex(/^blk_[a-z0-9_]{1,40}$/, '블록 ID가 올바르지 않습니다.');

const durationSecondsSchema = intIn(BLOCK_DURATION_RANGE, '블록 길이는', '초');
const enabledSchema = z.boolean('사용 여부가 올바르지 않습니다.');

const notApplicable = (message: string) => z.null(message).optional();

const blockCommon = {
  /** 없으면 새 블록이다. 서버가 발급한다 */
  id: blockIdSchema.optional(),
  durationSeconds: durationSecondsSchema,
  schedule: blockScheduleSchema.default({ type: 'ALWAYS' }),
  enabled: enabledSchema.default(true),
};

/**
 * PUT 입력의 블록. 응답에서는 id가 항상 있고 해당하지 않는 필드는 null이다.
 * GET 응답을 그대로 고쳐 보낼 수 있게, 해당하지 않는 필드는 null(또는 생략)만 받는다.
 */
export const blockInputSchema = z.discriminatedUnion(
  'source',
  [
    strict(
      {
        ...blockCommon,
        source: z.literal('SUBMISSIONS'),
        submissionType: z.enum(
          submissionTypeEnum.enumValues,
          '신청 종류가 올바르지 않습니다.',
        ),
        perVisit: intIn(
          PER_VISIT_RANGE,
          '한 번에 보여 줄 건수는',
          '건',
        ).nullish(),
        programId: notApplicable(
          'SUBMISSIONS 블록은 programId를 쓰지 않습니다.',
        ),
      },
      '블록이 올바르지 않습니다.',
    ),
    strict(
      {
        ...blockCommon,
        source: z.literal('PROGRAM'),
        programId: programIdSchema,
        submissionType: notApplicable(
          'PROGRAM 블록은 submissionType을 쓰지 않습니다.',
        ),
        perVisit: notApplicable('PROGRAM 블록은 perVisit을 쓰지 않습니다.'),
      },
      '블록이 올바르지 않습니다.',
    ),
  ],
  { error: '블록 종류가 올바르지 않습니다.' },
);
export type BlockInput = z.infer<typeof blockInputSchema>;

export const lineupInputSchema = strict(
  {
    version: z.int('version을 보내세요.').min(1, 'version을 보내세요.'),
    settings: lineupSettingsSchema,
    blocks: z
      .array(blockInputSchema, '블록 목록이 올바르지 않습니다.')
      .max(MAX_BLOCKS, `블록은 ${MAX_BLOCKS}개까지입니다.`),
  },
  '편성이 올바르지 않습니다.',
);
export type LineupInput = z.infer<typeof lineupInputSchema>;

/**
 * 기기 예외. settings는 바꾼 키만 둔다(infoBar·quietHours는 배열 전체를 바꾼다).
 * blocks는 그룹 편성의 블록 id → 사용 여부·길이다.
 */
export const deviceOverridesSchema = strict(
  {
    settings: lineupSettingsSchema.partial().default({}),
    blocks: z
      .record(
        blockIdSchema,
        strict(
          {
            enabled: enabledSchema.optional(),
            durationSeconds: durationSecondsSchema.optional(),
          },
          '블록 예외가 올바르지 않습니다.',
        ),
        {
          error: (issue) =>
            issue.code === 'invalid_key'
              ? '블록 ID가 올바르지 않습니다.'
              : '블록 예외가 올바르지 않습니다.',
        },
      )
      .default({}),
  },
  '기기 예외가 올바르지 않습니다.',
);
export type DeviceOverrides = z.infer<typeof deviceOverridesSchema>;

export const EMPTY_OVERRIDES: DeviceOverrides = { settings: {}, blocks: {} };
