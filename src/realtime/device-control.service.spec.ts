import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/index.js';
import {
  CHANGE_BATCH_MS,
  DeviceControlService,
} from './device-control.service.js';
import { GameRelay, type RelaySocket } from './game-relay.js';
import { SignageChanges } from './signage-changes.js';

function tv(id: string) {
  const sent: unknown[] = [];
  const socket: RelaySocket = {
    id,
    send: (text) => sent.push(JSON.parse(text)),
    close: () => undefined,
  };
  return { socket, sent };
}

const changed = { type: 'program-changed' };

describe('DeviceControlService', () => {
  let relay: GameRelay;
  let changes: SignageChanges;
  let service: DeviceControlService;
  let select: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    relay = new GameRelay();
    changes = new SignageChanges();
    // GROUP 범위만 DB를 읽는다. 이 테스트는 그 쿼리가 불리지 않는 경우만 본다
    select = vi.fn();
    service = new DeviceControlService(
      { selectDistinct: select } as unknown as Database,
      relay,
      changes,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('변경을 모아 연결된 기기에 한 번만 보낸다', async () => {
    const a = tv('a');
    const b = tv('b');
    relay.addHost('device-a', a.socket);
    relay.addHost('device-b', b.socket);

    changes.emit({ scope: 'DEVICE', id: 'device-a' });
    changes.emit({ scope: 'DEVICE', id: 'device-a' });
    changes.emit({ scope: 'DEVICE', id: 'device-missing' });
    await vi.advanceTimersByTimeAsync(CHANGE_BATCH_MS - 1);
    expect(a.sent).toEqual([{ type: 'ready' }]);

    await vi.advanceTimersByTimeAsync(1);
    expect(a.sent).toEqual([{ type: 'ready' }, changed]);
    expect(b.sent).toEqual([{ type: 'ready' }]);
    expect(select).not.toHaveBeenCalled();
  });

  it('ALL이 섞이면 연결된 모든 기기에 보낸다', async () => {
    const a = tv('a');
    const b = tv('b');
    relay.addHost('device-a', a.socket);
    relay.addHost('device-b', b.socket);

    changes.emit({ scope: 'GROUP', id: 'grp' });
    changes.emit({ scope: 'ALL' });
    await vi.advanceTimersByTimeAsync(CHANGE_BATCH_MS);
    expect(a.sent.at(-1)).toEqual(changed);
    expect(b.sent.at(-1)).toEqual(changed);
    expect(select).not.toHaveBeenCalled();
  });

  it('연결된 기기가 없으면 아무것도 읽지 않는다', async () => {
    changes.emit({ scope: 'GROUP', id: 'grp' });
    await vi.advanceTimersByTimeAsync(CHANGE_BATCH_MS);
    expect(select).not.toHaveBeenCalled();
  });

  it('reload는 연결돼 있을 때만 보낸다', () => {
    const a = tv('a');
    relay.addHost('device-a', a.socket);
    expect(service.isConnected('device-a')).toBe(true);
    expect(service.reload('device-a')).toBe(true);
    expect(a.sent.at(-1)).toEqual({ type: 'reload' });
    expect(service.isConnected('device-b')).toBe(false);
    expect(service.reload('device-b')).toBe(false);
  });
});
