import type { z } from 'zod';
import { strictObject } from '../../common/validation/zod.js';
import { CLICK_BATTLE_GAME } from '../../live/games/click-battle.game.js';
import type { ProgramType } from '../program-type.js';

const params = strictObject(
  {
    rounds: CLICK_BATTLE_GAME.config.shape.rounds.meta({ title: '판 수' }),
  },
  '클릭 배틀 설정이 올바르지 않습니다.',
);

/**
 * 편성 블록의 클릭 배틀. 블록 동안 TV가 QR을 띄우고 게임을 연다(호스트는 /devices/ws).
 * 라이브 GAME과 같은 게임이고, 판 수 범위도 같다.
 */
export const CLICK_BATTLE_PROGRAM: ProgramType<z.output<typeof params>> = {
  type: 'CLICK_BATTLE',
  name: '클릭 배틀',
  defaultDurationSeconds: 90,
  params,
  dataSource: 'NONE',
};
