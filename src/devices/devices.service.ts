import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { validationFailed } from '../common/errors/validation.js';
import { DB_CONNECTION, type Database, type Transaction } from '../db/index.js';
import { deviceTargetGroups, devices, type Device } from '../db/schema.js';
import { TargetGroupsService } from '../target-groups/target-groups.service.js';
import { generateDeviceToken, hashDeviceToken } from './auth/device-token.js';
import type {
  CreateDeviceDto,
  UpdateDeviceDto,
} from './dto/device-input.dto.js';
import type {
  DeviceDto,
  DeviceSessionDto,
  DeviceStatus,
  DeviceWithTokenDto,
} from './dto/device.dto.js';

// heartbeat는 60초마다 온다. 세 번 연속 빠지면 꺼진 것으로 본다.
const ONLINE_WITHIN_MS = 3 * 60 * 1000;

@Injectable()
export class DevicesService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly targetGroupsService: TargetGroupsService,
    private readonly auditService: AuditService,
  ) {}

  async list(): Promise<DeviceDto[]> {
    const rows = await this.db
      .select()
      .from(devices)
      .orderBy(asc(devices.name), asc(devices.id));
    const groups = await this.groupIdsOf(rows.map((row) => row.id));
    const now = new Date();
    return rows.map((row) => toDto(row, groups.get(row.id) ?? [], now));
  }

  async findOne(id: string): Promise<DeviceDto> {
    const row = await this.findRow(id);
    const groups = await this.groupIdsOf([id]);
    return toDto(row, groups.get(id) ?? [], new Date());
  }

  async create(
    admin: AuthUser,
    dto: CreateDeviceDto,
  ): Promise<DeviceWithTokenDto> {
    const groupIds = dto.groupIds ?? [];
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
          layout: dto.layout,
          rotationSeconds: dto.rotationSeconds,
          refreshAfterSeconds: dto.refreshAfterSeconds,
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
        metadata: { name: dto.name, groupIds },
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
    await this.findRow(id);
    if (dto.groupIds !== undefined) {
      await this.assertGroups(dto.groupIds);
    }

    const now = new Date();
    const changes = {
      name: dto.name,
      location: dto.location,
      orientation: dto.orientation,
      layout: dto.layout,
      rotationSeconds: dto.rotationSeconds,
      refreshAfterSeconds: dto.refreshAfterSeconds,
      isActive: dto.isActive,
    };
    const changedFields = [
      ...Object.entries(changes)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key),
      ...(dto.groupIds !== undefined ? ['groupIds'] : []),
    ];

    await this.db.transaction(async (tx) => {
      // undefined 필드는 drizzle이 SET에서 뺀다.
      await tx
        .update(devices)
        .set({ ...changes, updatedAt: now })
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

function statusOf(device: Device, now: Date): DeviceStatus {
  if (!device.isActive) {
    return 'DISABLED';
  }
  return device.lastSeenAt &&
    now.getTime() - device.lastSeenAt.getTime() <= ONLINE_WITHIN_MS
    ? 'ONLINE'
    : 'OFFLINE';
}

function toDto(device: Device, groupIds: string[], now: Date): DeviceDto {
  return {
    id: device.id,
    name: device.name,
    location: device.location,
    groupIds,
    orientation: device.orientation,
    resolution:
      device.resolutionWidth && device.resolutionHeight
        ? { width: device.resolutionWidth, height: device.resolutionHeight }
        : null,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    appVersion: device.appVersion,
    status: statusOf(device, now),
    layout: { type: device.layout, rotationSeconds: device.rotationSeconds },
    refreshAfterSeconds: device.refreshAfterSeconds,
    tokenIssuedAt: device.tokenIssuedAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}
