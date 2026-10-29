/**
 * TV 게임의 메시지 중계. 방 하나는 TV(호스트) 하나와 폰(참가자) 여럿이다.
 *
 * 게임 규칙은 모른다. 점수 계산·시간·입장 마감은 TV가 하고, 서버는 메시지를
 * 옮기기만 한다. 참가자 메시지는 호스트에게, 호스트 메시지는 방의 모든 참가자에게 간다.
 * 그래서 새 게임을 만들어도 서버를 고치지 않는다.
 *
 * 이 파일은 소켓 구현을 모른다. `RelaySocket`만 받아 단위 테스트할 수 있게 둔다.
 */
export interface RelaySocket {
  /** 서버가 정한 연결 id. 호스트는 참가자를 이 값으로 구분한다. */
  readonly id: string;
  send(text: string): void;
  close(code: number, reason: string): void;
}

export const RELAY_LIMITS = {
  /** 한 방의 참가자 상한. 클릭 배틀은 10명이지만 다른 게임을 위해 넉넉히 둔다. */
  maxPlayersPerRoom: 30,
  /** 서버 전체 동시 연결 상한 */
  maxConnections: 500,
  /** 메시지 한 개의 최대 크기(byte) */
  maxMessageBytes: 4096,
  /** 연결 하나가 1초에 보낼 수 있는 메시지 수. 넘는 메시지는 버린다. */
  messagesPerSecond: 40,
  /** 호스트가 연결 뒤 기기 토큰을 보내야 하는 시간 */
  authTimeoutMs: 5_000,
  /** 연결 확인(ping) 간격. 프록시가 놀고 있는 연결을 끊지 않게 한다. */
  heartbeatMs: 25_000,
} as const;

/** 브라우저에 알려 주는 종료 코드. 4000번대는 앱이 정한다. */
export const RELAY_CLOSE = {
  unauthorized: 4001,
  forbidden: 4003,
  roomFull: 4009,
  /** 같은 기기가 새로 연결해 이전 연결을 닫았다(TV 새로고침). */
  replaced: 4010,
  serverFull: 4013,
} as const;

/** 서버 → 참가자 */
export type PlayerFrame =
  | { type: 'host'; online: boolean }
  | { type: 'message'; data: unknown };

/** 서버 → 호스트 */
export type HostFrame =
  | { type: 'ready' }
  | { type: 'message'; from: string; data: unknown }
  | { type: 'left'; from: string };

interface Room {
  host: RelaySocket | null;
  players: Map<string, RelaySocket>;
}

export class GameRelay {
  private readonly rooms = new Map<string, Room>();

  private room(roomId: string): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { host: null, players: new Map() };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  private dropIfEmpty(roomId: string) {
    const room = this.rooms.get(roomId);
    if (room && !room.host && room.players.size === 0) this.rooms.delete(roomId);
  }

  private toPlayers(room: Room, frame: PlayerFrame) {
    const text = JSON.stringify(frame);
    for (const player of room.players.values()) player.send(text);
  }

  /** 인증된 TV를 방의 호스트로 둔다. 이미 있으면 이전 연결을 닫는다. */
  addHost(roomId: string, socket: RelaySocket): void {
    const room = this.room(roomId);
    const previous = room.host;
    room.host = socket;
    if (previous && previous !== socket) {
      previous.close(RELAY_CLOSE.replaced, 'Replaced by a newer connection');
    }
    socket.send(JSON.stringify({ type: 'ready' } satisfies HostFrame));
    this.toPlayers(room, { type: 'host', online: true });
  }

  /** 참가자를 방에 넣는다. 방이 차면 false */
  addPlayer(roomId: string, socket: RelaySocket): boolean {
    const room = this.room(roomId);
    if (room.players.size >= RELAY_LIMITS.maxPlayersPerRoom) {
      this.dropIfEmpty(roomId);
      return false;
    }
    room.players.set(socket.id, socket);
    socket.send(
      JSON.stringify({ type: 'host', online: room.host !== null } satisfies PlayerFrame),
    );
    return true;
  }

  /** 연결이 끊겼을 때. 호스트면 참가자에게, 참가자면 호스트에게 알린다. */
  remove(roomId: string, socket: RelaySocket): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.host === socket) {
      room.host = null;
      this.toPlayers(room, { type: 'host', online: false });
    } else if (room.players.get(socket.id) === socket) {
      room.players.delete(socket.id);
      room.host?.send(JSON.stringify({ type: 'left', from: socket.id } satisfies HostFrame));
    }
    this.dropIfEmpty(roomId);
  }

  /** 호스트가 보낸 메시지를 방의 모든 참가자에게. 밀려난 이전 호스트는 무시한다. */
  fromHost(roomId: string, socket: RelaySocket, data: unknown): void {
    const room = this.rooms.get(roomId);
    if (!room || room.host !== socket) return;
    this.toPlayers(room, { type: 'message', data });
  }

  /** 참가자가 보낸 메시지를 호스트에게. 호스트가 없으면 버린다. */
  fromPlayer(roomId: string, socket: RelaySocket, data: unknown): void {
    const room = this.rooms.get(roomId);
    if (!room?.host || room.players.get(socket.id) !== socket) return;
    room.host.send(
      JSON.stringify({ type: 'message', from: socket.id, data } satisfies HostFrame),
    );
  }

  /** 테스트·지표용 */
  stats(): { rooms: number; connections: number } {
    let connections = 0;
    for (const room of this.rooms.values()) {
      connections += room.players.size + (room.host ? 1 : 0);
    }
    return { rooms: this.rooms.size, connections };
  }
}

/** 초당 메시지 수 제한(토큰 버킷). 연결마다 하나씩 둔다. */
export class MessageBudget {
  private tokens: number = RELAY_LIMITS.messagesPerSecond;
  private refilledAt: number;

  constructor(now: number) {
    this.refilledAt = now;
  }

  take(now: number): boolean {
    const elapsed = (now - this.refilledAt) / 1000;
    this.refilledAt = now;
    this.tokens = Math.min(
      RELAY_LIMITS.messagesPerSecond,
      this.tokens + elapsed * RELAY_LIMITS.messagesPerSecond,
    );
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** 방 id는 기기 id다. 경로·로그에 그대로 쓰므로 모양을 좁힌다. */
export function isValidRoomId(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
