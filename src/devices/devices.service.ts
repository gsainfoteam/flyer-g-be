import { Trace } from '@gsainfoteam/nest-observability';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { validationFailed } from '../common/errors/validation.js';
import { parseOrFail } from '../common/validation/zod.js';
import { DB_CONNECTION, type Database, type Transaction } from '../db/index.js';
import { deviceTargetGroups, devices, type Device } from '../db/schema.js';
import {
  deviceOverridesSchema,
  type LineupSettings,
} from '../lineups/lineup-schema.js';
import {
  effectiveSettings,
  LineupsService,
} from '../lineups/lineups.service.js';
import { isQuietAt } from '../lineups/quiet-hours.js';
import type { LiveDto } from '../live/dto/live.dto.js';
import { liveDtoOf, LiveService } from '../live/live.service.js';
import { TargetGroupsService } from '../target-groups/target-groups.service.js';
import { generateDeviceToken, hashDeviceToken } from './auth/device-token.js';
import type {
  CreateDeviceDto,
  UpdateDeviceDto,
} from './dto/device-input.dto.js';
import type {
  DeviceDto,
  DeviceListDto,
  DeviceSessionDto,
  DeviceStatus,
  DeviceWithTokenDto,
} from './dto/device.dto.js';

// heartbeat는 30초마다 온다. 세 번 연속 빠지면 꺼진 것으로 본다.
const ONLINE_WITHIN_MS = 90 * 1000;

@Trace()
@Injectable()
export class DevicesService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly targetGroupsService: TargetGroupsService,
    private readonly lineupsService: LineupsService,
    private readonly liveService: LiveService,
    private readonly auditService: AuditService,
  ) {}

  async list(): Promise<DeviceListDto> {
    const rows = await this.db
      .select()
      .from(devices)
      .orderBy(asc(devices.name), asc(devices.id));
    const now = new Date();
    return {
      serverTime: now.toISOString(),
      items: await this.dtosOf(rows, now),
    };
  }

  async findOne(id: string): Promise<DeviceDto> {
    const [dto] = await this.dtosOf([await this.findRow(id)], new Date());
    return dto;
  }

  /** 기기 그룹, 실제 편성 설정, 실제 라이브를 한 번씩 읽어 응답을 만든다 */
  private async dtosOf(rows: Device[], now: Date): Promise<DeviceDto[]> {
    const groups = await this.groupIdsOf(rows.map((row) => row.id));
    const groupIdsByDevice = new Map(
      rows.map((row) => [row.id, groups.get(row.id) ?? []]),
    );
    const [settings, live] = await Promise.all([
      this.lineupsService.settingsOf(rows.map((row) => row.programGroupId)),
      this.liveService.effectiveFor(groupIdsByDevice, now),
    ]);
    return rows.map((row) =>
      toDto(row, {
        groupIds: groupIdsByDevice.get(row.id) ?? [],
        settings: effectiveSettings(row, settings),
        live: liveDtoOf(live.get(row.id) ?? null),
        now,
      }),
    );
  }

  async create(
    admin: AuthUser,
    dto: CreateDeviceDto,
  ): Promise<DeviceWithTokenDto> {
    const groupIds = dto.groupIds ?? [];
    const programGroupId = dto.programGroupId ?? groupIds[0];
    if (programGroupId === undefined) {
      throw validationFailed({
        programGroupId:
          '편성 그룹을 고르세요. 위치 그룹(groupIds)이 하나 이상 있어야 합니다.',
      });
    }
    assertProgramGroupIn(programGroupId, groupIds);
    await this.assertGroups(groupIds);

    const now = new Date();
    const token = generateDeviceToken();
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(devices)
        .values({
          name: dto.name,
          location: dto.location ?? null,
          orientation: dto.orientation,
          programGroupId,
          tokenHash: hashDeviceToken(token),
          tokenIssuedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: devices.id });
      await this.replaceGroups(tx, row.id, groupIds);
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'DEVICE_REGISTERED',
        target: { type: 'DEVICE', id: row.id },
        metadata: { name: dto.name, groupIds, programGroupId },
        at: now,
      });
      return row.id;
    });

    return { ...(await this.findOne(id)), token };
  }

  async update(
    admin: AuthUser,
    id: string,
    dto: UpdateDeviceDto,
  ): Promise<DeviceDto> {
    const current = await this.findRow(id);
    const currentGroups = (await this.groupIdsOf([id])).get(id) ?? [];
    const programGroupId = dto.programGroupId ?? current.programGroupId;
    assertProgramGroupIn(programGroupId, dto.groupIds ?? currentGroups);
    if (dto.groupIds !== undefined) {
      // 이미 연결된 숨긴 그룹은 그대로 둘 수 있다. 새로 추가하는 그룹만 확인한다.
      await this.assertGroups(
        dto.groupIds.filter((groupId) => !currentGroups.includes(groupId)),
      );
    }
    const overrides =
      dto.overrides === undefined
        ? current.lineupOverrides
        : parseOrFail(deviceOverridesSchema, dto.overrides, 'overrides');

    const now = new Date();
    const changes = {
      name: dto.name,
      location: dto.location,
      orientation: dto.orientation,
      isActive: dto.isActive,
      programGroupId: dto.programGroupId,
    };
    const changedFields = [
      ...Object.entries(changes)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key),
      ...(dto.groupIds !== undefined ? ['groupIds'] : []),
      ...(dto.overrides !== undefined ? ['overrides'] : []),
    ];

    await this.db.transaction(async (tx) => {
      // 편성 그룹에 없는 블록 예외는 저장할 때마다 지운다.
      const lineupOverrides = await this.lineupsService.prepareOverrides(
        tx,
        programGroupId,
        overrides,
      );
      // undefined 필드는 drizzle이 SET에서 뺀다.
      await tx
        .update(devices)
        .set({ ...changes, lineupOverrides, updatedAt: now })
        .where(eq(devices.id, id));
      if (dto.groupIds !== undefined) {
        await this.replaceGroups(tx, id, dto.groupIds);
      }
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'DEVICE_UPDATED',
        target: { type: 'DEVICE', id },
        metadata: { changedFields },
        at: now,
      });
    });

    return this.findOne(id);
  }

  /** 새 토큰을 발급하고 이전 토큰은 즉시 무효가 된다. 분실·유출 시 쓴다. */
  async rotateToken(admin: AuthUser, id: string): Promise<DeviceWithTokenDto> {
    await this.findRow(id);
    const now = new Date();
    const token = generateDeviceToken();

    await this.db.transaction(async (tx) => {
      await tx
        .update(devices)
        .set({
          tokenHash: hashDeviceToken(token),
          tokenIssuedAt: now,
          updatedAt: now,
        })
        .where(eq(devices.id, id));
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'DEVICE_TOKEN_ROTATED',
        target: { type: 'DEVICE', id },
        at: now,
      });
    });

    return { ...(await this.findOne(id)), token };
  }

  session(device: Device): DeviceSessionDto {
    return {
      deviceId: device.id,
      name: device.name,
      location: device.location,
      orientation: device.orientation,
      serverTime: new Date().toISOString(),
    };
  }

  private async findRow(id: string): Promise<Device> {
    const [row] = await this.db
      .select()
      .from(devices)
      .where(eq(devices.id, id));
    if (!row) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Device not found',
      );
    }
    return row;
  }

  private async groupIdsOf(ids: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (ids.length === 0) {
      return result;
    }
    const rows = await this.db
      .select()
      .from(deviceTargetGroups)
      .where(inArray(deviceTargetGroups.deviceId, ids))
      .orderBy(asc(deviceTargetGroups.targetGroupId));
    for (const row of rows) {
      result.set(row.deviceId, [
        ...(result.get(row.deviceId) ?? []),
        row.targetGroupId,
      ]);
    }
    return result;
  }

  private async assertGroups(groupIds: string[]): Promise<void> {
    const unavailable =
      await this.targetGroupsService.findUnavailable(groupIds);
    if (unavailable.length > 0) {
      throw validationFailed({
        groupIds: `선택할 수 없는 위치 그룹이 있습니다: ${unavailable.join(', ')}`,
      });
    }
  }

  private async replaceGroups(
    tx: Transaction,
    deviceId: string,
    groupIds: string[],
  ): Promise<void> {
    await tx
      .delete(deviceTargetGroups)
      .where(eq(deviceTargetGroups.deviceId, deviceId));
    if (groupIds.length > 0) {
      await tx
        .insert(deviceTargetGroups)
        .values(groupIds.map((targetGroupId) => ({ deviceId, targetGroupId })));
    }
  }
}

/** 화면 끔 시간에는 heartbeat가 없어도 꺼진 것(OFFLINE)으로 보지 않는다 */
function statusOf(
  device: Device,
  settings: LineupSettings,
  now: Date,
): DeviceStatus {
  if (!device.isActive) {
    return 'DISABLED';
  }
  if (isQuietAt(settings.quietHours, now)) {
    return 'SLEEPING';
  }
  return device.lastSeenAt &&
    now.getTime() - device.lastSeenAt.getTime() <= ONLINE_WITHIN_MS
    ? 'ONLINE'
    : 'OFFLINE';
}

/** 편성 그룹은 기기 그룹 중 하나여야 한다(FE 요청 2-1). */
function assertProgramGroupIn(
  programGroupId: string,
  groupIds: string[],
): void {
  if (!groupIds.includes(programGroupId)) {
    throw validationFailed({
      programGroupId: '편성 그룹은 위치 그룹(groupIds) 중 하나여야 합니다.',
    });
  }
}

function toDto(
  device: Device,
  {
    groupIds,
    settings,
    live,
    now,
  }: {
    groupIds: string[];
    settings: LineupSettings;
    live: LiveDto | null;
    now: Date;
  },
): DeviceDto {
  return {
    id: device.id,
    name: device.name,
    location: device.location,
    groupIds,
    programGroupId: device.programGroupId,
    overrides: device.lineupOverrides,
    orientation: device.orientation,
    resolution:
      device.resolutionWidth && device.resolutionHeight
        ? { width: device.resolutionWidth, height: device.resolutionHeight }
        : null,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    appVersion: device.appVersion,
    lastPlaylistVersion: device.lastPlaylistVersion,
    lastRenderOkAt: device.lastRenderOkAt?.toISOString() ?? null,
    now: device.nowPlaying,
    live,
    status: statusOf(device, settings, now),
    layout: {
      type: settings.posterLayout,
      rotationSeconds: settings.rotationSeconds,
    },
    refreshAfterSeconds: settings.refreshAfterSeconds,
    tokenIssuedAt: device.tokenIssuedAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}
