import type { LiveAlert, LiveMain } from './live-schema.js';
import { activeLayer, resolveLive, type LiveLayer } from './resolve-live.js';

const NOW = new Date('2026-11-02T03:00:00.000Z');
const later = '2026-11-02T04:00:00.000Z';
const earlier = '2026-11-02T02:00:00.000Z';

const show = (until: string | null = null): LiveMain => ({
  action: 'SHOW',
  submissionId: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34',
  programId: null,
  until,
});
const alert = (text: string, until: string | null = null): LiveAlert => ({
  text,
  until,
});
const layer = (
  name: string,
  setAt: string,
  parts: Partial<Pick<LiveLayer, 'main' | 'alert'>>,
): LiveLayer => ({
  main: null,
  alert: null,
  setBy: { id: name, name },
  setAt: new Date(setAt),
  ...parts,
});

describe('resolveLive', () => {
  it('기기 값이 그룹 값보다 우선하고 main·alert를 따로 고른다', () => {
    const device = layer('기기', '2026-11-02T01:00:00Z', { main: show() });
    const group = layer('그룹', '2026-11-02T02:00:00Z', {
      main: show(later),
      alert: alert('단수'),
    });
    expect(resolveLive(device, [group], NOW)).toEqual({
      main: device.main,
      alert: group.alert,
      // 고른 부분 중 가장 최근에 정한 것
      setBy: group.setBy,
      setAt: group.setAt,
    });
  });

  it('until이 지난 기기 값은 없는 것으로 보고 그룹 값을 쓴다', () => {
    const device = layer('기기', '2026-11-02T01:00:00Z', {
      main: show(earlier),
    });
    const group = layer('그룹', '2026-11-02T00:00:00Z', { main: show() });
    expect(resolveLive(device, [group], NOW)).toMatchObject({
      main: group.main,
      alert: null,
      setBy: group.setBy,
    });
  });

  it('여러 그룹이면 가장 최근에 정한 그룹 값', () => {
    const old = layer('옛 그룹', '2026-11-02T00:00:00Z', {
      alert: alert('옛 알림'),
    });
    const recent = layer('새 그룹', '2026-11-02T02:00:00Z', {
      alert: alert('새 알림'),
    });
    expect(resolveLive(null, [old, recent], NOW)?.alert?.text).toBe('새 알림');
  });

  it('남는 것이 없으면 null', () => {
    const expired = layer('기기', '2026-11-02T01:00:00Z', {
      main: show(earlier),
      alert: alert('끝남', earlier),
    });
    expect(resolveLive(expired, [], NOW)).toBeNull();
    expect(resolveLive(null, [], NOW)).toBeNull();
  });
});

describe('activeLayer', () => {
  it('until이 지난 부분만 뺀다', () => {
    const stored = layer('기기', '2026-11-02T01:00:00Z', {
      main: show(earlier),
      alert: alert('남음', later),
    });
    expect(activeLayer(stored, NOW)).toEqual({ ...stored, main: null });
    expect(
      activeLayer({ ...stored, alert: alert('끝남', earlier) }, NOW),
    ).toBeNull();
  });
});
