import { z } from 'zod';
import type { GameType } from './game-type.js';

/** 클릭 배틀. 두 팀이 폰으로 버튼을 눌러 겨룬다. 판 수만 정한다 */
export const CLICK_BATTLE_GAME = {
  type: 'CLICK_BATTLE',
  config: z.strictObject(
    {
      type: z.literal('CLICK_BATTLE'),
      rounds: z
        .int('판 수는 정수여야 합니다.')
        .min(1, '판 수는 1 이상이어야 합니다.')
        .max(10, '판 수는 10 이하여야 합니다.'),
    },
    '게임 설정이 올바르지 않습니다.',
  ),
} as const satisfies GameType;
