import type { LiveAlert, LiveMain } from './live-schema.js';

/** 한 범위(기기 또는 그룹)에 저장된 라이브 */
export type LiveLayer = {
  main: LiveMain | null;
  alert: LiveAlert | null;
  setBy: { id: string; name: string };
  setAt: Date;
};

const alive = (part: { until?: string | null } | null, now: Date) =>
  part !== null && (!part.until || Date.parse(part.until) > now.getTime());

/** until이 지난 부분을 뺀다. 남는 것이 없으면 null */
export function activeLayer(
  layer: LiveLayer | null,
  now: Date,
): LiveLayer | null {
  if (!layer) {
    return null;
  }
  const main = alive(layer.main, now) ? layer.main : null;
  const alert = alive(layer.alert, now) ? layer.alert : null;
  return main || alert ? { ...layer, main, alert } : null;
}

/**
 * 기기가 실제로 띄울 라이브. main과 alert를 따로 고른다: 기기 값이 있으면 기기 값, 없으면 그룹 값.
 * 기기가 여러 그룹에 속하면 가장 최근에 정한 그룹 값을 쓴다. until이 지난 것은 없는 것으로 본다.
 * setBy·setAt은 고른 부분 중 가장 최근에 정한 것이다.
 */
export function resolveLive(
  device: LiveLayer | null,
  groups: LiveLayer[],
  now: Date,
): LiveLayer | null {
  const layers = [
    device,
    ...[...groups].sort((a, b) => b.setAt.getTime() - a.setAt.getTime()),
  ].filter((layer): layer is LiveLayer => layer !== null);
  const mainFrom = layers.find((layer) => alive(layer.main, now));
  const alertFrom = layers.find((layer) => alive(layer.alert, now));
  if (!mainFrom && !alertFrom) {
    return null;
  }
  const newest = [mainFrom, alertFrom]
    .filter((layer): layer is LiveLayer => layer !== undefined)
    .reduce((a, b) => (b.setAt > a.setAt ? b : a));
  return {
    main: mainFrom?.main ?? null,
    alert: alertFrom?.alert ?? null,
    setBy: newest.setBy,
    setAt: newest.setAt,
  };
}
