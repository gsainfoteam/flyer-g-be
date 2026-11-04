import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { Env } from '../config/env.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { devices, games} from '../db/schema.js';
import {
  hashDeviceToken,
  looksLikeDeviceToken,
} from '../devices/auth/device-token.js';
import {
  ConnectionCounter,
  GameRelay,
  MessageBudget,
  clientIp,
  RELAY_CLOSE,
  RELAY_LIMITS,
  isValidRoomId,
  type RelaySocket,
} from './game-relay.js';

/** TV 연결 경로. 제어 채널이자 게임 호스트다. 기기는 기기 토큰으로 정한다. */
export const DEVICE_SOCKET_PATH = '/devices/ws';
/** 게임 연결 경로. 참가자(폰)용. `role=host`는 정리 때까지 남긴다. */
export const GAME_SOCKET_PATH = '/games/ws';

const ROOM_CACHE_MS = 60_000;
/** 방 확인 결과를 기억할 최대 개수. 넘으면 비운다. 없는 id로 메모리를 채우지 못하게. */
const ROOM_CACHE_LIMIT = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Role = 'host' | 'player';

/**
 * TV·게임 WebSocket. REST API와 같은 호스트에 둔다.
 *
 * - `wss://<api>/devices/ws`: TV 하나의 연결. 연결 뒤 첫 메시지로 `{ type: "auth", token }`을
 *   보낸다(5초 안). 토큰이 정한 기기가 방이 된다. 서버는 이 연결로 제어 프레임
 *   (`program-changed`, `reload`)을 보내고, 같은 연결이 그 방의 게임 호스트다.
 * - `wss://<api>/games/ws?room=<기기 id>&role=player`: 참가자(폰). 로그인 없이 붙는다.
 *   이름 같은 정보는 게임 메시지에 실어 TV가 다룬다.
 * - `wss://<api>/games/ws?room=<기기 id>&role=host`: 이전 TV 경로. `/devices/ws`와 같고,
 *   토큰이 다른 기기의 것이면 4003으로 닫는다.
 *
 * 기존 HTTP 라우트·가드와 섞이지 않게 Nest의 WebSocket 게이트웨이 대신 HTTP 서버의
 * upgrade 요청을 이 경로들만 직접 받는다. 토큰은 URL에 싣지 않는다(로그에 남는다).
 * 메시지는 `{ type: "send", data }` 하나다. 크기·빈도 상한을 넘으면 버린다.
 *
 * 연결은 이 프로세스 메모리에만 있다. TV와 참가자, 변경을 일으킨 요청이 같은 프로세스에
 * 있어야 하므로 서버는 하나만 띄운다(지금 게임 중계와 같은 전제).
 */
@Injectable()
export class RealtimeSocketService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeSocketService.name);
  private server: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly alive = new WeakSet<WebSocket>();
  /** IP별, IP·방별 연결 수 */
  private readonly perIp = new ConnectionCounter();
  /** 참가자가 붙으려는 방(기기)이 있는지. 매번 DB를 보지 않게 잠시 기억한다. */
  private readonly knownRooms = new Map<
    string,
    { active: boolean; at: number }
  >();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: ConfigService<Env, true>,
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly relay: GameRelay,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = this.adapterHost.httpAdapter.getHttpServer() as {
      on(
        event: 'upgrade',
        listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
      ): void;
      listenerCount(event: 'upgrade'): number;
    };
    this.server = new WebSocketServer({
      noServer: true,
      maxPayload: RELAY_LIMITS.maxMessageBytes,
    });

    httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === DEVICE_SOCKET_PATH) {
        this.handleUpgrade(request, socket, head, null, 'host');
        return;
      }
      if (url.pathname === GAME_SOCKET_PATH) {
        const roomId = url.searchParams.get('room');
        const role = url.searchParams.get('role');
        if (!isValidRoomId(roomId) || (role !== 'host' && role !== 'player')) {
          return this.reject(socket, 400, 'Bad Request');
        }
        this.handleUpgrade(request, socket, head, roomId, role);
        return;
      }
      // 다른 경로의 upgrade는 원래대로 둔다. Node는 upgrade 리스너가 하나도 없을 때만
      // 그 연결을 스스로 닫는다. 이 리스너가 생겨 그 동작이 사라지지 않도록, 다른
      // 리스너가 없으면 대신 닫는다.
      if (httpServer.listenerCount('upgrade') === 1) socket.destroy();
    });

    // 응답이 없는 연결을 정리하고, 프록시가 놀고 있는 연결을 끊지 않게 한다.
    this.heartbeat = setInterval(() => {
      for (const client of this.server?.clients ?? []) {
        if (!this.alive.has(client)) {
          client.terminate();
          continue;
        }
        this.alive.delete(client);
        client.ping();
      }
    }, RELAY_LIMITS.heartbeatMs);
    // 이 타이머 때문에 프로세스가 내려가지 못하는 일이 없게 한다(테스트 등).
    this.heartbeat.unref();

    this.logger.log(
      `Sockets listening on ${DEVICE_SOCKET_PATH} and ${GAME_SOCKET_PATH}`,
    );
  }

  onApplicationShutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.server?.clients ?? []) {
      client.close(1001, 'Server shutting down');
    }
    this.server?.close();
  }

  private reject(socket: Duplex, status: number, message: string) {
    // 응답을 다 보낸 뒤 닫는다. 바로 destroy하면 브라우저는 이유 없이 끊긴 것으로 본다.
    socket.end(
      `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }

  private allowedOrigin(origin: string | undefined): boolean {
    const allowed = this.config.get('CORS_ALLOWED_ORIGINS', { infer: true });
    // 허용 목록이 비면(로컬) 막지 않는다. CORS와 같은 기준이다.
    if (allowed.length === 0) return true;
    if (!origin) return false;
    try {
      return allowed.includes(new URL(origin).origin);
    } catch {
      return false;
    }
  }

  /** roomId가 null이면 `/devices/ws`다. 방은 인증한 기기로 정한다. */
  private handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    roomId: string | null,
    role: Role,
  ) {
    if (!this.allowedOrigin(request.headers.origin)) {
      return this.reject(socket, 403, 'Forbidden');
    }
    const server = this.server;
    if (!server) return this.reject(socket, 503, 'Service Unavailable');
    if (server.clients.size >= RELAY_LIMITS.maxConnections) {
      return this.reject(socket, 503, 'Service Unavailable');
    }
    const ip = clientIp(
      request.headers['x-forwarded-for'],
      request.socket.remoteAddress,
    );
    // 방을 아는 연결만 IP·방별로 센다. TV(`/devices/ws`)는 인증해야 방을 안다.
    const keys = roomId === null ? [ip] : [ip, `${ip}|${roomId}`];
    if (
      this.perIp.get(ip) >= RELAY_LIMITS.maxConnectionsPerIp ||
      (roomId !== null &&
        this.perIp.get(keys[1]!) >= RELAY_LIMITS.maxConnectionsPerIpPerRoom)
    ) {
      return this.reject(socket, 429, 'Too Many Requests');
    }
    // 연결 수를 먼저 잡아 둔다. 방 확인을 기다리는 사이 같은 IP가 한꺼번에 몰려도
    // 상한을 넘지 못한다.
    for (const key of keys) this.perIp.add(key);
    const release = () => {
      for (const key of keys) this.perIp.remove(key);
    };

    // 참가자는 실제 기기의 방에만 붙는다. 없는 방에 연결을 쌓아 두지 못하게 한다.
    // TV는 기기 토큰으로 따로 확인한다.
    const check =
      role === 'player' && roomId !== null
        ? this.roomExists(roomId)
        : Promise.resolve(true);
    void check.then((exists) => {
      // 확인을 기다리는 사이 요청자가 떠났으면 정리만 한다.
      if (socket.destroyed) return release();
      if (!exists) {
        release();
        return this.reject(socket, 404, 'Not Found');
      }
      server.handleUpgrade(request, socket, head, (client) => {
        client.once('close', release);
        this.accept(client, roomId, role);
      });
    });
  }

  /** 활성 기기의 id인지. 결과를 1분 동안 기억한다. */
  private async roomExists(roomId: string): Promise<boolean> {
    const cached = this.knownRooms.get(roomId);
    if (cached && Date.now() - cached.at < ROOM_CACHE_MS) return cached.active;
    // 기기 id는 uuid다. 다른 모양은 DB에 묻지 않는다(Postgres가 형식 오류를 낸다).
    if (!UUID.test(roomId)) return false;
    try {
      const [device] = await this.db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, roomId), eq(devices.isActive, true)));
      const active = device !== undefined;
      if (this.knownRooms.size > ROOM_CACHE_LIMIT) this.knownRooms.clear();
      this.knownRooms.set(roomId, { active, at: Date.now() });
      return active;
    } catch (error) {
      this.logger.error('Failed to look up game room', error);
      return false;
    }
  }

  private accept(client: WebSocket, requestedRoom: string | null, role: Role) {
    const socket: RelaySocket = {
      id: randomUUID(),
      send: (text) => {
        if (client.readyState === WebSocket.OPEN) client.send(text);
      },
      close: (code, reason) => client.close(code, reason),
    };
    const budget = new MessageBudget(Date.now());
    /** 방에 들어간 뒤에만 정해진다. TV는 인증해야 정해진다. */
    let roomId: string | null = null;

    this.alive.add(client);
    client.on('pong', () => this.alive.add(client));
    client.on('close', () => {
      if (roomId !== null) this.relay.remove(roomId, socket);
    });
    client.on('error', (error) =>
      this.logger.warn(`Socket error: ${error.message}`),
    );

    if (role === 'player') {
      if (!this.relay.addPlayer(requestedRoom!, socket)) {
        client.close(RELAY_CLOSE.roomFull, 'Room is full');
        return;
      }
      roomId = requestedRoom;
      this.recordVisit(requestedRoom!);
    } else {
      const timer = setTimeout(
        () =>
          client.close(RELAY_CLOSE.unauthorized, 'Authentication timed out'),
        RELAY_LIMITS.authTimeoutMs,
      );
      client.once('close', () => clearTimeout(timer));
      client.once('message', (raw) => {
        clearTimeout(timer);
        void this.authenticateHost(raw).then((deviceId) => {
          if (client.readyState !== WebSocket.OPEN) return;
          if (deviceId === null) {
            client.close(RELAY_CLOSE.unauthorized, 'Invalid device token');
            return;
          }
          if (requestedRoom !== null && deviceId !== requestedRoom) {
            client.close(
              RELAY_CLOSE.forbidden,
              'Token does not match this room',
            );
            return;
          }
          roomId = deviceId;
          this.relay.addHost(deviceId, socket);
        });
      });
    }

    client.on('message', (raw) => {
      if (roomId === null || !budget.take(Date.now())) return;
      const data = readSend(raw);
      if (data === undefined) return;
      if (role === 'host') this.relay.fromHost(roomId, socket, data);
      else this.relay.fromPlayer(roomId, socket, data);
    });
  }

  /**게임 접속 기록을 남긴다. 기다리지 않는다. 실패해도 게임은 그대로 이어지고 로그만 남긴다. */
  private recordVisit(deviceId: string): void {
    this.db
      .insert(games)
      .values({ deviceId })
      .catch((error: unknown) =>
        this.logger.warn('Failed to record game visit', error),
      );
  }

  /** 첫 메시지의 기기 토큰이 활성 기기의 것이면 그 기기 id */
  private async authenticateHost(raw: RawData): Promise<string | null> {
    const frame = parse(raw);
    const token =
      frame && frame.type === 'auth' && typeof frame.token === 'string'
        ? frame.token
        : null;
    if (!token || !looksLikeDeviceToken(token)) return null;

    try {
      const [device] = await this.db
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.tokenHash, hashDeviceToken(token)),
            eq(devices.isActive, true),
          ),
        );
      return device?.id ?? null;
    } catch (error) {
      this.logger.error('Failed to verify device token', error);
      return null;
    }
  }
}

function parse(raw: RawData): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw.toString());
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `{ type: "send", data }`의 data. 다른 모양이면 undefined */
function readSend(raw: RawData): unknown {
  const frame = parse(raw);
  return frame?.type === 'send' && 'data' in frame ? frame.data : undefined;
}
