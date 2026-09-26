// 한국은 서머타임이 없어 UTC+9로 고정이다.
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 서울 달력 기준으로 n개월 뒤의 같은 시각. 그 달에 같은 날짜가 없으면 말일로 맞춘다.
 * 예: 2026-01-31 10:00 KST + 1개월 = 2026-02-28 10:00 KST
 */
export function addMonthsInSeoul(date: Date, months: number): Date {
  // UTC 필드가 서울 벽시계 시각을 나타내도록 옮긴다.
  const local = new Date(date.getTime() + SEOUL_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const shifted = Date.UTC(
    year,
    month,
    Math.min(local.getUTCDate(), lastDay),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  );
  return new Date(shifted - SEOUL_OFFSET_MS);
}

/** 서울 달력 날짜 (YYYY-MM-DD) */
export function seoulDate(date: Date): string {
  return new Date(date.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

/** 서울 날짜(YYYY-MM-DD)의 00:00 KST 시각 */
export function startOfSeoulDay(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - SEOUL_OFFSET_MS);
}

/** 서울 날짜에 n일을 더한 날짜 */
export function addSeoulDays(day: string, days: number): string {
  return seoulDate(
    new Date(startOfSeoulDay(day).getTime() + days * 86_400_000),
  );
}
