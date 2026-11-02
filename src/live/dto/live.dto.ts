import { ApiProperty } from '@nestjs/swagger';
import { openApiOf } from '../../common/validation/zod.js';
import { LineupEditorDto } from '../../lineups/dto/lineup.dto.js';
import {
  liveAlertSchema,
  liveMainSchema,
  type LiveAlert,
  type LiveMain,
} from '../live-schema.js';

export const MAIN_DOC = {
  allOf: [openApiOf(liveMainSchema, 'output')],
  nullable: true,
  description: `편성 위에 덮는 장면. 없으면 null
- SHOW: { action, submissionId | programId (둘 중 하나), until? } 신청 컨텐츠 하나나 운영 컨텐츠 하나를 띄운다. until이 없으면 해제할 때까지
- GAME: { action, game: { type: CLICK_BATTLE, rounds }, until } 게임을 연다. until은 필수이고 지금부터 3시간 안이다`,
  example: {
    action: 'GAME',
    game: { type: 'CLICK_BATTLE', rounds: 3 },
    until: '2026-10-30T03:50:00.000Z',
  },
};

export const ALERT_DOC = {
  allOf: [openApiOf(liveAlertSchema, 'output')],
  nullable: true,
  description: '화면 위 알림 띠. { text(1~80자), until? }. 없으면 null',
  example: {
    text: '오늘 18:00–20:00 B동 단수 예정',
    until: '2026-10-30T11:00:00.000Z',
  },
};

/** 라이브 상태. until이 지난 부분은 null로 나간다 */
export class LiveDto {
  @ApiProperty(MAIN_DOC)
  main: LiveMain | null;

  @ApiProperty(ALERT_DOC)
  alert: LiveAlert | null;

  @ApiProperty({
    description:
      '정한 운영자. 기기 응답에서는 고른 부분 중 가장 최근에 정한 사람. 라이브가 없으면 null',
    type: LineupEditorDto,
    nullable: true,
  })
  setBy: LineupEditorDto | null;

  @ApiProperty({
    description: '정한 시각. 라이브가 없으면 null',
    type: String,
    nullable: true,
    example: '2026-10-30T03:10:00.000Z',
  })
  setAt: string | null;
}

/** 라이브 API에서 저장된 라이브가 없을 때의 본문 */
export const NO_LIVE: LiveDto = {
  main: null,
  alert: null,
  setBy: null,
  setAt: null,
};

/** 편성 응답 v2의 live. 운영자 정보는 TV에 보내지 않는다 */
export class PlaylistLiveDto {
  @ApiProperty(MAIN_DOC)
  main: LiveMain | null;

  @ApiProperty(ALERT_DOC)
  alert: LiveAlert | null;

  @ApiProperty({ example: '2026-10-30T03:10:00.000Z' })
  setAt: string;
}
