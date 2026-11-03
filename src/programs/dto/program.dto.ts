import { ApiProperty } from '@nestjs/swagger';
import {
  DATA_STATES,
  PROGRAM_DATA_SOURCES,
  type DataState,
  type ProgramDataSource,
} from '../program-type.js';
import { PROGRAM_TYPE_NAMES } from '../program-types.js';

/** 운영 컨텐츠 종류. 관리 화면은 paramsSchema로 설정 폼을 만든다 */
export class ProgramTypeDto {
  @ApiProperty({ enum: PROGRAM_TYPE_NAMES, example: 'DDAY' })
  type: string;

  @ApiProperty({ example: 'D-day' })
  name: string;

  @ApiProperty({
    description: '편성 블록을 새로 만들 때 넣을 길이(초)',
    example: 5,
  })
  defaultDurationSeconds: number;

  @ApiProperty({
    description:
      'data를 어디서 얻나. NONE: 없음(data null), GENERATED: 서버가 계산, DATASET: 데이터셋(⑪), COLLECTOR: 수집기(⑬)',
    enum: PROGRAM_DATA_SOURCES,
    example: 'NONE',
  })
  dataSource: ProgramDataSource;

  @ApiProperty({
    description:
      'dataSource가 DATASET일 때 데이터셋 key. 지금 종류는 모두 null',
    type: String,
    nullable: true,
    example: null,
  })
  dataset: string | null;

  @ApiProperty({
    description:
      'dataSource가 COLLECTOR일 때 수집기 key. 지금 종류는 모두 null',
    type: String,
    nullable: true,
    example: null,
  })
  collector: string | null;

  @ApiProperty({
    description:
      '정보줄에서 이 종류가 맡는 칸(settings.infoBar[].item). null이면 정보줄에 쓸 수 없다',
    type: String,
    nullable: true,
    example: 'DDAY',
  })
  infoBarItem: string | null;

  @ApiProperty({
    description:
      'params의 JSON Schema(OpenAPI 3.0 부분집합: object·string·integer·number·boolean·array·enum, format date, title, minLength·maxLength·minimum·maximum, nullable). 서버도 이 모양으로 검증한다',
    type: 'object',
    additionalProperties: true,
    example: {
      type: 'object',
      properties: {
        label: { type: 'string', minLength: 1, maxLength: 20, title: '이름' },
        date: { type: 'string', format: 'date', title: '날짜' },
      },
      required: ['label', 'date'],
      additionalProperties: false,
    },
  })
  paramsSchema: Record<string, unknown>;
}

export class DataStatusDto {
  @ApiProperty({ enum: DATA_STATES, example: 'OK' })
  state: DataState;

  @ApiProperty({
    description: '목록 한 줄에 그대로 쓰는 문구',
    example: 'D-12',
  })
  detail: string;

  @ApiProperty({
    description:
      '데이터를 마지막으로 받은 시각. 받는 데이터가 없는 종류는 null',
    type: String,
    nullable: true,
    example: null,
  })
  updatedAt: string | null;
}

export class ProgramDto {
  @ApiProperty({ example: 'prg_3f9a1c2b7d4e' })
  id: string;

  @ApiProperty({ enum: PROGRAM_TYPE_NAMES, example: 'DDAY' })
  type: string;

  @ApiProperty({ example: '기말고사 D-day' })
  name: string;

  @ApiProperty({
    description: '종류의 paramsSchema 모양',
    type: 'object',
    additionalProperties: true,
    example: { label: '기말고사', date: '2026-12-15' },
  })
  params: Record<string, unknown>;

  @ApiProperty({
    description: '편성 블록이나 그룹 정보줄이 이 운영 컨텐츠를 가리키는 그룹',
    type: [String],
    example: ['grp_a_dorm'],
  })
  usedByGroupIds: string[];

  @ApiProperty({
    description: '기기 예외 정보줄이 이 운영 컨텐츠를 가리키는 기기',
    type: [String],
    example: [],
  })
  usedByDeviceIds: string[];

  @ApiProperty({
    description:
      '데이터 상태. D-day·시험 응원은 날짜가 지나면 STALE. 알릴 상태가 없는 종류는 null',
    type: DataStatusDto,
    nullable: true,
  })
  dataStatus: DataStatusDto | null;

  @ApiProperty({ example: '2026-11-03T02:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-03T02:00:00.000Z' })
  updatedAt: string;
}
