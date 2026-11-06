import { randomUUID } from 'node:crypto';
import { deviceStatusOf } from '../devices/device-status.js';
import { DEFAULT_LINEUP_SETTINGS } from '../lineups/lineup-schema.js';
import { evaluateDeviceAlert } from './device-alert-policy.js';

const now = new Date('2026-11-06T01:00:00Z');
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
const device = {
  id: randomUUID(),
  isActive: true,
  lastSeenAt: ago(91),
  updatedAt: ago(3600),
};
const settings = DEFAULT_LINEUP_SETTINGS;

describe('TV 장애 판정', () => {
  it('90초 경계를 관리자 화면과 공유한다', () => {
    expect(
      deviceStatusOf({ ...device, lastSeenAt: ago(90) }, settings, now),
    ).toBe('ONLINE');
    expect(deviceStatusOf(device, settings, now)).toBe('OFFLINE');
    expect(
      evaluateDeviceAlert(device, settings, undefined, now).shouldAlert,
    ).toBe(true);
  });

  it('미접속·비활성·화면 끔 시간에는 알리지 않는다', () => {
    expect(
      evaluateDeviceAlert(
        { ...device, lastSeenAt: null },
        settings,
        undefined,
        now,
      ).shouldAlert,
    ).toBe(false);
    expect(
      evaluateDeviceAlert(
        { ...device, isActive: false },
        settings,
        undefined,
        now,
      ).state.status,
    ).toBe('DISABLED');
    const sleeping = {
      ...settings,
      quietHours: [{ start: '22:00', end: '11:00' }],
    };
    expect(
      evaluateDeviceAlert(device, sleeping, undefined, now).state.status,
    ).toBe('SLEEPING');
  });

  it('화면 끔 시간 종료 직후에는 이전 감지 기록이 없어도 유예한다', () => {
    const sleeping = {
      ...settings,
      quietHours: [{ start: '22:00', end: '10:00' }],
    };
    expect(
      evaluateDeviceAlert(device, sleeping, undefined, now).shouldAlert,
    ).toBe(false);
    expect(
      evaluateDeviceAlert(
        device,
        sleeping,
        undefined,
        new Date(now.getTime() + 91_000),
      ).shouldAlert,
    ).toBe(true);
  });

  it('재활성화·설정 변경 후 유예는 재시작해도 유지된다', () => {
    const previous = evaluateDeviceAlert(
      { ...device, isActive: false },
      settings,
      undefined,
      ago(60),
    ).state;
    const first = evaluateDeviceAlert(device, settings, previous, now);
    expect(first.shouldAlert).toBe(false);
    expect(
      evaluateDeviceAlert(
        device,
        settings,
        first.state,
        new Date(now.getTime() + 60_000),
      ).shouldAlert,
    ).toBe(false);
    expect(
      evaluateDeviceAlert(
        device,
        settings,
        first.state,
        new Date(now.getTime() + 91_000),
      ).shouldAlert,
    ).toBe(true);
    expect(
      evaluateDeviceAlert(
        { ...device, updatedAt: ago(30) },
        settings,
        undefined,
        now,
      ).shouldAlert,
    ).toBe(false);
  });

  it('같은 장애는 반복하지 않고 새 heartbeat가 있으면 다시 알릴 수 있다', () => {
    const previous = {
      ...evaluateDeviceAlert(device, settings, undefined, now).state,
      incidentId: randomUUID(),
    };
    expect(
      evaluateDeviceAlert(device, settings, previous, now).shouldAlert,
    ).toBe(false);
    const nextTime = new Date(now.getTime() + 180_000);
    const recoveredThenOffline = {
      ...device,
      lastSeenAt: new Date(now.getTime() + 30_000),
    };
    expect(
      evaluateDeviceAlert(recoveredThenOffline, settings, previous, nextTime)
        .shouldAlert,
    ).toBe(true);
    expect(
      evaluateDeviceAlert(
        { ...device, lastSeenAt: now },
        settings,
        previous,
        now,
      ).state.incidentId,
    ).toBeNull();
  });

  it('밤을 지나도 heartbeat가 한 번도 복구되지 않은 장애는 반복하지 않는다', () => {
    const previous = {
      ...evaluateDeviceAlert(device, settings, undefined, now).state,
      incidentId: randomUUID(),
    };
    const sleeping = {
      ...settings,
      quietHours: [{ start: '09:00', end: '11:00' }],
    };
    const sleepState = evaluateDeviceAlert(
      device,
      sleeping,
      previous,
      now,
    ).state;
    expect(sleepState.incidentId).toBe(previous.incidentId);
    expect(
      evaluateDeviceAlert(
        device,
        settings,
        sleepState,
        new Date(now.getTime() + 7200_000),
      ).shouldAlert,
    ).toBe(false);
  });

  it('알려진 장애에서 새 heartbeat를 받으면 복구 회차를 한 번만 반환한다', () => {
    const incidentId = randomUUID();
    const previous = {
      ...evaluateDeviceAlert(device, settings, undefined, ago(60)).state,
      incidentId,
    };
    const connected = { ...device, lastSeenAt: now };
    const result = evaluateDeviceAlert(connected, settings, previous, now);
    expect(result.recoveredIncidentId).toBe(incidentId);
    expect(result.state.incidentId).toBeNull();
    expect(
      evaluateDeviceAlert(connected, settings, result.state, now)
        .recoveredIncidentId,
    ).toBeNull();
    expect(
      evaluateDeviceAlert(connected, settings, undefined, now)
        .recoveredIncidentId,
    ).toBeNull();
  });

  it('단순 휴면 전환·비활성화·이미 다시 끊긴 heartbeat는 복구로 알리지 않는다', () => {
    const previous = {
      ...evaluateDeviceAlert(device, settings, undefined, ago(60)).state,
      incidentId: randomUUID(),
    };
    const sleeping = {
      ...settings,
      quietHours: [{ start: '09:00', end: '11:00' }],
    };
    expect(
      evaluateDeviceAlert(device, sleeping, previous, now).recoveredIncidentId,
    ).toBeNull();
    expect(
      evaluateDeviceAlert(
        { ...device, isActive: false, lastSeenAt: now },
        settings,
        previous,
        now,
      ).recoveredIncidentId,
    ).toBeNull();
    expect(
      evaluateDeviceAlert(
        { ...device, lastSeenAt: ago(30) },
        settings,
        previous,
        new Date(now.getTime() + 180_000),
      ).recoveredIncidentId,
    ).toBeNull();
    // 화면 끔 시간에도 실제로 새 heartbeat가 도착하면 연결 복구를 확인할 수 있다.
    expect(
      evaluateDeviceAlert(
        { ...device, lastSeenAt: now },
        sleeping,
        previous,
        now,
      ).recoveredIncidentId,
    ).toBe(previous.incidentId);
  });
});
