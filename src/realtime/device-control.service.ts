import { Trace } from '@gsainfoteam/nest-observability';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { deviceTargetGroups, devices } from '../db/schema.js';
import { GameRelay, RELAY_CLOSE } from './game-relay.js';
import { SignageChanges, type SignageChange } from './signage-changes.js';

/** 변경을 모으는 시간. 한 번의 저장이 여러 변경을 내도 TV는 한 번만 다시 받는다 */
export const CHANGE_BATCH_MS = 1_000;

/**
 * 연결된 TV에 제어 프레임을 보낸다. 연결은 GameRelay의 호스트 자리다.
 * 변경 알림은 모아서 보내고, 보낼 기기는 연결된 기기 중에서만 고른다.
 */
@Trace()
@Injectable()
export class DeviceControlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceControlService.name);
  private pending: SignageChange[] = [];
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly relay: GameRelay,
    private readonly changes: SignageChanges,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.changes.subscribe((change) => this.queue(change));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
  }

  isConnected(deviceId: string): boolean {
    return this.relay.hasHost(deviceId);
  }

  /** TV에 페이지를 다시 불러오게 한다. 연결돼 있지 않으면 false */
  reload(deviceId: string): boolean {
    return this.relay.toHost(deviceId, { type: 'reload' });
  }

  /** 토큰을 바꾸거나 기기를 껐을 때. TV는 다시 인증해야 한다 */
  disconnect(deviceId: string): void {
    this.relay.closeHost(
      deviceId,
      RELAY_CLOSE.unauthorized,
      'Device token is no longer valid',
    );
  }

  private queue(change: SignageChange): void {
    this.pending.push(change);
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), CHANGE_BATCH_MS);
    this.timer.unref();
  }

  private async flush(): Promise<void> {
    const changes = this.pending;
    this.pending = [];
    this.timer = null;
    try {
      for (const deviceId of await this.targetsOf(changes)) {
        this.relay.toHost(deviceId, { type: 'program-changed' });
      }
    } catch (error) {
      // 놓쳐도 TV는 refreshAfterSeconds마다 다시 받는다
      this.logger.error('Failed to notify devices', error);
    }
  }

  private async targetsOf(changes: SignageChange[]): Promise<string[]> {
    const connected = this.relay.hostIds();
    if (connected.length === 0) {
      return [];
    }
    if (changes.some((change) => change.scope === 'ALL')) {
      return connected;
    }
    const idsOf = (scope: 'GROUP' | 'DEVICE') =>
      changes.flatMap((change) => (change.scope === scope ? [change.id] : []));
    const targets = new Set(
      idsOf('DEVICE').filter((id) => connected.includes(id)),
    );
    const groupIds = idsOf('GROUP');
    if (groupIds.length > 0) {
      const rows = await this.db
        .selectDistinct({ id: devices.id })
        .from(devices)
        .leftJoin(
          deviceTargetGroups,
          eq(deviceTargetGroups.deviceId, devices.id),
        )
        .where(
          and(
            inArray(devices.id, connected),
            or(
              inArray(devices.programGroupId, groupIds),
              inArray(deviceTargetGroups.targetGroupId, groupIds),
            ),
          ),
        );
      for (const row of rows) targets.add(row.id);
    }
    return [...targets];
  }
}
