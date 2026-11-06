import type { Device } from '../db/schema.js';
import type { LineupSettings } from '../lineups/lineup-schema.js';
import { isQuietAt } from '../lineups/quiet-hours.js';
import type { DeviceStatus } from './dto/device.dto.js';

// heartbeat는 30초마다 온다. 세 번 연속 빠지면 꺼진 것으로 본다.
export const ONLINE_WITHIN_MS = 90_000;

export function hasRecentHeartbeat(
  device: Pick<Device, 'lastSeenAt'>,
  now: Date,
): boolean {
  return (
    device.lastSeenAt !== null &&
    now.getTime() - device.lastSeenAt.getTime() <= ONLINE_WITHIN_MS
  );
}

/** 관리자 화면과 장애 감지가 공유하는 상태 판정. */
export function deviceStatusOf(
  device: Pick<Device, 'isActive' | 'lastSeenAt'>,
  settings: LineupSettings,
  now: Date,
): DeviceStatus {
  if (!device.isActive) return 'DISABLED';
  if (isQuietAt(settings.quietHours, now)) return 'SLEEPING';
  return hasRecentHeartbeat(device, now) ? 'ONLINE' : 'OFFLINE';
}
