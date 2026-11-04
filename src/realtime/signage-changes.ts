import { Injectable } from '@nestjs/common';

/**
 * TV 편성에 영향을 주는 변경의 범위.
 * - ALL: 모든 기기 (신청 승인·중단·취소, 상태 배치)
 * - GROUP: 그 그룹을 편성 그룹이나 위치 그룹으로 가진 기기 (그룹 편성, 그룹 라이브)
 * - DEVICE: 그 기기 (기기 설정·예외, 기기 라이브)
 */
export type SignageChange =
  | { scope: 'ALL' }
  | { scope: 'GROUP'; id: string }
  | { scope: 'DEVICE'; id: string };

type Listener = (change: SignageChange) => void;

/**
 * 편성이 바뀌었다는 알림. 바꾸는 서비스는 커밋 뒤에 `emit` 한 줄만 부른다.
 * 누구에게 어떻게 알릴지는 듣는 쪽(DeviceControlService)이 정한다.
 */
@Injectable()
export class SignageChanges {
  private readonly listeners = new Set<Listener>();

  emit(change: SignageChange): void {
    for (const listener of this.listeners) listener(change);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
