import { describe, expect, it } from 'vitest';
import {
  GameRelay,
  MessageBudget,
  RELAY_CLOSE,
  RELAY_LIMITS,
  isValidRoomId,
  type RelaySocket,
} from './game-relay.js';

interface FakeSocket extends RelaySocket {
  sent: unknown[];
  closed: { code: number; reason: string } | null;
}

function socket(id: string): FakeSocket {
  const fake: FakeSocket = {
    id,
    sent: [],
    closed: null,
    send: (text) => fake.sent.push(JSON.parse(text)),
    close: (code, reason) => {
      fake.closed = { code, reason };
    },
  };
  return fake;
}

describe('GameRelay', () => {
  it('참가자 메시지는 호스트에게, 호스트 메시지는 모든 참가자에게 간다', () => {
    const relay = new GameRelay();
    const host = socket('tv');
    const a = socket('a');
    const b = socket('b');
    relay.addHost('room', host);
    relay.addPlayer('room', a);
    relay.addPlayer('room', b);

    relay.fromPlayer('room', a, { kind: 'join' });
    expect(host.sent).toContainEqual({ type: 'message', from: 'a', data: { kind: 'join' } });

    relay.fromHost('room', host, { kind: 'state' });
    expect(a.sent).toContainEqual({ type: 'message', data: { kind: 'state' } });
    expect(b.sent).toContainEqual({ type: 'message', data: { kind: 'state' } });
  });

  it('참가자는 호스트가 있는지 알고, 호스트가 오가면 다시 듣는다', () => {
    const relay = new GameRelay();
    const a = socket('a');
    relay.addPlayer('room', a);
    expect(a.sent).toEqual([{ type: 'host', online: false }]);

    const host = socket('tv');
    relay.addHost('room', host);
    expect(host.sent).toEqual([{ type: 'ready' }]);
    expect(a.sent.at(-1)).toEqual({ type: 'host', online: true });

    relay.remove('room', host);
    expect(a.sent.at(-1)).toEqual({ type: 'host', online: false });
  });

  it('호스트가 없을 때 참가자 메시지는 버린다', () => {
    const relay = new GameRelay();
    const a = socket('a');
    relay.addPlayer('room', a);
    expect(() => relay.fromPlayer('room', a, 1)).not.toThrow();
  });

  it('같은 방에 새 호스트가 오면 이전 연결을 닫고 그 메시지를 무시한다', () => {
    const relay = new GameRelay();
    const old = socket('tv-1');
    const next = socket('tv-2');
    const a = socket('a');
    relay.addHost('room', old);
    relay.addPlayer('room', a);
    relay.addHost('room', next);

    expect(old.closed?.code).toBe(RELAY_CLOSE.replaced);
    const before = a.sent.length;
    relay.fromHost('room', old, 'stale');
    expect(a.sent).toHaveLength(before);
    // 닫힌 이전 호스트의 close 이벤트가 새 호스트를 지우지 않는다.
    relay.remove('room', old);
    relay.fromPlayer('room', a, 'hi');
    expect(next.sent).toContainEqual({ type: 'message', from: 'a', data: 'hi' });
  });

  it('참가자가 나가면 호스트에게 알린다', () => {
    const relay = new GameRelay();
    const host = socket('tv');
    const a = socket('a');
    relay.addHost('room', host);
    relay.addPlayer('room', a);
    relay.remove('room', a);
    expect(host.sent.at(-1)).toEqual({ type: 'left', from: 'a' });
  });

  it('방이 차면 받지 않고, 다른 방과는 섞이지 않는다', () => {
    const relay = new GameRelay();
    for (let index = 0; index < RELAY_LIMITS.maxPlayersPerRoom; index++) {
      expect(relay.addPlayer('room', socket(`p${index}`))).toBe(true);
    }
    expect(relay.addPlayer('room', socket('late'))).toBe(false);

    const other = socket('tv-other');
    relay.addHost('other', other);
    relay.fromPlayer('room', socket('p0'), 'x');
    expect(other.sent).toEqual([{ type: 'ready' }]);
  });

  it('모두 나가면 방을 지운다', () => {
    const relay = new GameRelay();
    const host = socket('tv');
    const a = socket('a');
    relay.addHost('room', host);
    relay.addPlayer('room', a);
    relay.remove('room', a);
    relay.remove('room', host);
    expect(relay.stats()).toEqual({ rooms: 0, connections: 0 });
  });
});

describe('MessageBudget', () => {
  it('초당 상한을 넘는 메시지를 버리고 시간이 지나면 다시 받는다', () => {
    const budget = new MessageBudget(0);
    let accepted = 0;
    for (let index = 0; index < 100; index++) {
      if (budget.take(0)) accepted++;
    }
    expect(accepted).toBe(RELAY_LIMITS.messagesPerSecond);
    expect(budget.take(500)).toBe(true);
  });
});

describe('isValidRoomId', () => {
  it('기기 id 모양만 받는다', () => {
    expect(isValidRoomId('3f2a9c1e-7b4d-4a8e-9f00-1234567890ab')).toBe(true);
    expect(isValidRoomId('../etc')).toBe(false);
    expect(isValidRoomId('')).toBe(false);
    expect(isValidRoomId(null)).toBe(false);
  });
});
