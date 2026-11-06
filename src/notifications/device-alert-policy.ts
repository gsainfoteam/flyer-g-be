import type { Device, deviceAlertStates } from '../db/schema.js';
import {
  deviceStatusOf,
  hasRecentHeartbeat,
  ONLINE_WITHIN_MS,
} from '../devices/device-status.js';
import type { LineupSettings } from '../lineups/lineup-schema.js';
import { isQuietAt } from '../lineups/quiet-hours.js';

type AlertState = typeof deviceAlertStates.$inferSelect;

/** 최근 90초 사이 화면 끔 시간이 있었는가. 스케줄러가 잠들어 있었어도 기동 유예를 준다. */
function recentlySleeping(settings: LineupSettings, now: Date): boolean {
  for (let offset = 0; offset <= ONLINE_WITHIN_MS; offset += 30_000) {
    if (isQuietAt(settings.quietHours, new Date(now.getTime() - offset)))
      return true;
  }
  return false;
}

export function evaluateDeviceAlert(
  device: Pick<Device, 'id' | 'isActive' | 'lastSeenAt' | 'updatedAt'>,
  settings: LineupSettings,
  previous: AlertState | undefined,
  now: Date,
): {
  state: AlertState;
  shouldAlert: boolean;
  recoveredIncidentId: string | null;
} {
  const status = deviceStatusOf(device, settings, now);
  // 폴링 사이 잠깐 복구했다 다시 끊긴 경우도 새 heartbeat로 구분한다.
  const recovered =
    device.lastSeenAt !== null &&
    device.lastSeenAt.getTime() >
      (previous?.observedLastSeenAt?.getTime() ?? 0);
  let incidentId = recovered ? null : (previous?.incidentId ?? null);
  let graceUntil = previous?.graceUntil ?? now;

  if (status === 'ONLINE' || status === 'DISABLED') incidentId = null;
  if (!device.lastSeenAt || status === 'DISABLED' || status === 'SLEEPING') {
    graceUntil = new Date(now.getTime() + ONLINE_WITHIN_MS);
  } else if (
    previous &&
    (previous.status === 'DISABLED' ||
      previous.status === 'SLEEPING' ||
      device.updatedAt > previous.checkedAt)
  ) {
    // 운영자가 설정을 바꾼 직후에도 플레이어가 새 설정을 받을 시간을 준다.
    graceUntil = new Date(now.getTime() + ONLINE_WITHIN_MS);
  }

  return {
    // 새 heartbeat로 연결이 확인되어야 한다. SLEEPING 상태 전환만으로는 복구가 아니다.
    recoveredIncidentId:
      recovered && device.isActive && hasRecentHeartbeat(device, now)
        ? (previous?.incidentId ?? null)
        : null,
    state: {
      deviceId: device.id,
      status,
      observedLastSeenAt: device.lastSeenAt,
      graceUntil,
      incidentId,
      checkedAt: now,
    },
    shouldAlert:
      status === 'OFFLINE' &&
      !!device.lastSeenAt &&
      !incidentId &&
      now >= graceUntil &&
      !recentlySleeping(settings, now) &&
      now.getTime() - device.updatedAt.getTime() > ONLINE_WITHIN_MS,
  };
}
