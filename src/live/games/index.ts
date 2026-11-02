import { z } from 'zod';
import { CLICK_BATTLE_GAME } from './click-battle.game.js';

/** 라이브 main.game. 게임 종류를 더하면 이 배열에 정의의 config를 한 줄 더한다 */
export const gameConfigSchema = z.discriminatedUnion(
  'type',
  [CLICK_BATTLE_GAME.config],
  { error: '게임 종류가 올바르지 않습니다.' },
);
