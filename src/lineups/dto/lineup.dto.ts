import { ApiProperty } from '@nestjs/swagger';
import { openApiOf } from '../../common/validation/zod.js';
import { submissionTypeEnum, type SubmissionType } from '../../db/schema.js';
import {
  blockScheduleSchema,
  deviceOverridesSchema,
  lineupSettingsSchema,
  type BlockSchedule,
  type LineupSettings,
} from '../lineup-schema.js';

/** jsonb 모양은 zod 스키마에서 만든다(src/lineups/lineup-schema.ts). */
export const SETTINGS_DOC = {
  allOf: [openApiOf(lineupSettingsSchema, 'output')],
  description: `편성 설정
- posterLayout: 포스터 블록의 화면 방식. WALL 모아 보기, STRIP 흐르는 띠
- rotationSeconds: 포스터 한 장이 머무는 시간(초, 5~60)
- refreshAfterSeconds: TV가 편성을 다시 받는 주기(초, 15~300)
- infoBar: 정보줄 칸 { item, programId } 순서대로, 4칸까지. item마다 쓸 수 있는 운영 컨텐츠 종류가 정해져 있다(GET /signage/program-types의 infoBarItem). 시계와 "다음 장면"은 칸이 아니라 항상 나온다
- quietHours: 화면 끔 시간 { start, end } (서울 HH:mm). end가 start보다 이르면 자정을 넘는다`,
};

export const OVERRIDES_DOC = {
  allOf: [openApiOf(deviceOverridesSchema, 'output')],
  description: `기기 예외. 그룹 편성 위에 덮어쓴다
- settings: 바꾼 설정 키만 (infoBar·quietHours는 배열 전체를 바꾼다)
- blocks: 블록 id → { enabled?, durationSeconds? }. 그룹에서 지워진 블록 id는 무시하고, 기기를 저장할 때 지운다`,
};

export class LineupBlockDto {
  @ApiProperty({
    description: '그룹 안에서 고유한 블록 ID. 서버가 발급한다',
    example: 'blk_3f9a1c2b7d4e',
  })
  id: string;

  @ApiProperty({
    description: 'SUBMISSIONS: 심사받은 신청 컨텐츠, PROGRAM: 운영 컨텐츠',
    enum: ['SUBMISSIONS', 'PROGRAM'],
    example: 'SUBMISSIONS',
  })
  source: 'SUBMISSIONS' | 'PROGRAM';

  @ApiProperty({
    description: 'source가 SUBMISSIONS일 때 신청 종류. 아니면 null',
    enum: submissionTypeEnum.enumValues,
    nullable: true,
    example: 'POSTER',
  })
  submissionType: SubmissionType | null;

  @ApiProperty({
    description: 'source가 PROGRAM일 때 운영 컨텐츠 ID. 아니면 null',
    type: String,
    nullable: true,
    example: null,
  })
  programId: string | null;

  @ApiProperty({ description: '블록 길이(초, 5~300)', example: 60 })
  durationSeconds: number;

  @ApiProperty({
    description:
      'source가 SUBMISSIONS일 때 한 번 나올 때 보여 줄 건수(1~10). 아니면 null',
    type: Number,
    nullable: true,
    example: 3,
  })
  perVisit: number | null;

  @ApiProperty({
    allOf: [openApiOf(blockScheduleSchema, 'output')],
    description: `나오는 때 (서울 기준)
- { type: ALWAYS }
- { type: WINDOWS, windows: [{ days: [1~7, 1=월], start: HH:mm, end: HH:mm }] }
- { type: DATE_RANGE, from: ISO, to: ISO }`,
    example: { type: 'ALWAYS' },
  })
  schedule: BlockSchedule;

  @ApiProperty({ example: true })
  enabled: boolean;
}

export class LineupEditorDto {
  @ApiProperty({ example: '3c1e9a7b-5b7d-4e21-9a0c-1d8e5f6b2c34' })
  id: string;

  @ApiProperty({ example: '김운영' })
  name: string;
}

export class LineupDto {
  @ApiProperty({ example: 'grp_house_a' })
  groupId: string;

  @ApiProperty({
    description: '낙관적 잠금. PUT에 그대로 보낸다. 저장할 때마다 1씩 오른다',
    example: 7,
  })
  version: number;

  @ApiProperty({
    ...SETTINGS_DOC,
    example: {
      posterLayout: 'WALL',
      rotationSeconds: 10,
      refreshAfterSeconds: 60,
      infoBar: [],
      quietHours: [{ start: '02:00', end: '06:00' }],
    },
  })
  settings: LineupSettings;

  @ApiProperty({
    description: '블록. 배열 순서가 재생 순서다',
    type: [LineupBlockDto],
  })
  blocks: LineupBlockDto[];

  @ApiProperty({ example: '2026-11-02T03:00:00.000Z' })
  updatedAt: string;

  @ApiProperty({
    description:
      '마지막으로 저장한 운영자. 이전 마이그레이션으로 만든 편성은 null',
    type: LineupEditorDto,
    nullable: true,
  })
  updatedBy: LineupEditorDto | null;
}
