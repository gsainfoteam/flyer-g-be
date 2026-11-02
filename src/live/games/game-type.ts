import type { z } from 'zod';

/**
 * 라이브 게임 종류. 종류 하나 = 정의 파일 하나다(games/index.ts에 한 줄 더한다).
 * 서버는 게임 규칙을 모르고 중계만 하므로(src/games/game-relay.ts) 정의는 설정 모양뿐이다.
 */
export interface GameType {
  readonly type: string;
  /** 라이브 main.game의 모양. type 리터럴을 포함한 strict 객체다 */
  readonly config: z.ZodObject;
}
