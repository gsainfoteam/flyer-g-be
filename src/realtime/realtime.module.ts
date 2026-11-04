import { Module } from '@nestjs/common';
import { DeviceControlService } from './device-control.service.js';
import { GameRelay } from './game-relay.js';
import { RealtimeSocketService } from './realtime-socket.service.js';
import { SignageChanges } from './signage-changes.js';

/**
 * TV 실시간 연결(제어 채널과 게임 중계). 다른 모듈에 기대지 않는다.
 * 기기 토큰 확인만 devices의 해시 함수와 devices 테이블을 읽는다.
 * 편성을 바꾸는 모듈은 SignageChanges로 알리고, 기기 API는 DeviceControlService를 쓴다.
 */
@Module({
  providers: [
    GameRelay,
    SignageChanges,
    DeviceControlService,
    RealtimeSocketService,
  ],
  exports: [SignageChanges, DeviceControlService],
})
export class RealtimeModule {}
