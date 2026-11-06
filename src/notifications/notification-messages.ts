import type { Device } from '../db/schema.js';
import type { pendingReviewSummary } from '../submissions/review-summary.js';
import type { NotificationMessage } from './notification-presentation.js';

export function koreanTime(date: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(date);
}

export function offlineMessage(
  device: Pick<Device, 'name' | 'location' | 'lastSeenAt'>,
  now: Date,
): NotificationMessage {
  const elapsed = Math.floor(
    (now.getTime() - device.lastSeenAt!.getTime()) / 1000,
  );
  const text = [
    'TV 연결 끊김 감지',
    `기기: ${device.name}`,
    `위치: ${device.location ?? '미지정'}`,
    `마지막 heartbeat: ${koreanTime(device.lastSeenAt!)} (한국 시간)`,
    `heartbeat 미수신: ${elapsed}초`,
    `확인 시각: ${koreanTime(now)} (한국 시간)`,
  ].join('\n');
  return {
    kind: 'DEVICE_OFFLINE',
    text,
    presentation: {
      title: '📺 TV 연결 끊김',
      color: '#E01E5A',
      summary: `*${elapsedLabel(elapsed)} 동안 응답이 없어요.*\nTV의 전원과 네트워크 연결을 확인해 주세요.`,
      fields: [
        { label: '기기', value: device.name },
        { label: '위치', value: device.location ?? '미지정' },
        { label: '마지막 응답', value: koreanTime(device.lastSeenAt!) },
        { label: '연결 상태', value: '오프라인' },
      ],
      context: `Flyer-G · ${koreanTime(now)} 감지 · 한국 시간`,
    },
  };
}

export function reviewMessage(
  rows: Awaited<ReturnType<typeof pendingReviewSummary>>,
  now: Date,
): NotificationMessage {
  const count = (type: string) =>
    rows.find((row) => row.type === type)?.pendingReview ?? 0;
  const total = rows.reduce((sum, row) => sum + row.pendingReview, 0);
  const oldest = new Date(
    Math.min(...rows.map((row) => row.oldestSubmittedAt.getTime())),
  );
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - oldest.getTime()) / 60_000),
  );
  const text = [
    `승인 대기 요청이 ${total}건 있습니다.`,
    `포스터 ${count('POSTER')}건 · 이벤트 배너 ${count('EVENT_BANNER')}건 · 제보 ${count('STORY')}건`,
    `가장 오래된 요청: ${koreanTime(oldest)} (대기 ${Math.floor(minutes / 60)}시간 ${minutes % 60}분)`,
    `집계 시각: ${koreanTime(now)} (한국 시간)`,
  ].join('\n');
  return {
    kind: 'REVIEW_REMINDER',
    text,
    presentation: {
      title: '📋 승인 대기 리마인드',
      color: '#2EB67D',
      summary: `*${total}건의 요청이 승인을 기다리고 있어요.*\n포스터 *${count('POSTER')}건*  ·  이벤트 배너 *${count('EVENT_BANNER')}건*  ·  제보 *${count('STORY')}건*`,
      fields: [
        { label: '가장 오래 기다린 요청', value: elapsedLabel(minutes * 60) },
        { label: '해당 요청 접수 시각', value: koreanTime(oldest) },
      ],
      context: `Flyer-G · ${koreanTime(now)} 집계 · 한국 시간`,
    },
  };
}

/** 긴 대기 시간도 초 단위 숫자 대신 읽기 쉬운 단위로 표시한다. */
function elapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;
  return `${Math.floor(hours / 24)}일${hours % 24 ? ` ${hours % 24}시간` : ''}`;
}

/** 평일 10:00·16:00 KST의 분 단위 키. 늦게 실행된 다른 파드도 같은 키를 쓴다. */
export function reviewReminderSlot(now: Date): string | null {
  const local = new Date(now.getTime() + 9 * 3600_000);
  const weekday = local.getUTCDay();
  if (
    weekday === 0 ||
    weekday === 6 ||
    local.getUTCMinutes() !== 0 ||
    ![10, 16].includes(local.getUTCHours())
  )
    return null;
  return local.toISOString().slice(0, 16);
}
