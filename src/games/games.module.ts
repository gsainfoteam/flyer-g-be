import { Module } from '@nestjs/common';
import { GameSocketService } from './game-socket.service.js';

/**
 * TV 게임 실시간 중계. 다른 모듈에 기대지 않고, 다른 모듈도 이 모듈을 쓰지 않는다.
 * 기기 토큰 확인만 devices의 해시 함수와 devices 테이블을 읽는다.
 */
@Module({
  providers: [GameSocketService],
})
export class GamesModule {}
