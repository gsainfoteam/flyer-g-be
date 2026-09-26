import type { FieldErrors } from '../common/errors/app.exception.js';
import { addMonthsInSeoul } from '../common/time/seoul-time.js';
import type { SubmissionStatus } from '../db/schema.js';
import { SIGNAGE_POLICY } from '../policy/signage-policy.js';

const ZIGGLE_HOST = 'ziggle.gistory.me';
const ZIGGLE_NOTICE_PATH = /^\/notice\/([A-Za-z0-9_-]{1,64})\/?$/;

export type ParsedDetailUrl = {
  url: string;
  /** Ziggle 공지 주소면 공지 ID, 아니면 null */
  ziggleNoticeId: string | null;
};

/**
 * 상세 링크(QR)를 검증한다. 허용된 호스트의 HTTPS만 받는다.
 * 공지 ID는 클라이언트 값 대신 URL에서 뽑아 "공지 하나에 신청 하나"의 기준으로 쓴다.
 */
export function parseDetailUrl(
  raw: string,
): ParsedDetailUrl | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: '올바른 주소가 아닙니다.' };
  }
  if (url.protocol !== 'https:') {
    return { error: 'https:// 로 시작하는 주소만 쓸 수 있습니다.' };
  }
  const hosts: readonly string[] = SIGNAGE_POLICY.allowedDetailUrlHosts;
  if (
    url.username ||
    url.password ||
    url.port ||
    !hosts.includes(url.hostname)
  ) {
    return {
      error: `${hosts.join(', ')} 의 주소만 쓸 수 있습니다.`,
    };
  }

  const match =
    url.hostname === ZIGGLE_HOST ? ZIGGLE_NOTICE_PATH.exec(url.pathname) : null;
  return { url: url.toString(), ziggleNoticeId: match?.[1] ?? null };
}

/**
 * 게시 기간 규칙. 검토 대기에 들어갈 때(생성·재제출)와 기간을 바꿀 때 검사한다.
 * 기준 시각은 항상 서버 시각이다.
 */
export function validateSchedule(
  startAt: Date,
  endAt: Date,
  now: Date,
): FieldErrors {
  const errors: FieldErrors = {};
  const { minLeadTimeHours, maxPublishMonths } = SIGNAGE_POLICY;

  const earliestStart = new Date(now.getTime() + minLeadTimeHours * 3600_000);
  if (startAt < earliestStart) {
    errors.startAt = `게시 시작은 신청 시각으로부터 ${minLeadTimeHours}시간 이후여야 합니다.`;
  }

  if (endAt <= startAt) {
    errors.endAt = '종료 시각은 시작 시각보다 뒤여야 합니다.';
  } else if (endAt <= now) {
    errors.endAt = '종료 시각이 이미 지났습니다.';
  } else if (endAt > addMonthsInSeoul(startAt, maxPublishMonths)) {
    errors.endAt = `게시 기간은 최대 ${maxPublishMonths}개월입니다.`;
  }

  return errors;
}

/** 신청자가 내용을 고칠 수 있는 상태. 게시가 시작된 뒤에는 운영자에게 중단을 요청한다. */
export const EDITABLE_STATUSES: readonly SubmissionStatus[] = [
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
];

/** 승인된 내용을 고치면 다시 승인받아야 한다(FR-INT-02). */
export const REAPPROVAL_STATUSES: readonly SubmissionStatus[] = [
  'APPROVED',
  'SCHEDULED',
];

/** 검토를 다시 요청할 수 있는 상태 */
export const SUBMITTABLE_STATUSES: readonly SubmissionStatus[] = [
  'DRAFT',
  'REJECTED',
];

/**
 * 신청자가 취소할 수 있는가. 승인됐더라도 게시가 아직 시작되지 않았으면 취소할 수 있다.
 * 배치가 상태를 늦게 바꿔도 시작 시각으로 판정하므로 이미 게시 중인 건은 막힌다.
 */
export function canCancel(
  status: SubmissionStatus,
  startAt: Date,
  now: Date,
): boolean {
  if (
    status === 'DRAFT' ||
    status === 'PENDING_REVIEW' ||
    status === 'REJECTED'
  ) {
    return true;
  }
  return (status === 'APPROVED' || status === 'SCHEDULED') && now < startAt;
}

/** 게시가 이미 시작됐는가 (배치 지연과 무관하게 기간으로 판정) */
export function hasStartedPublishing(
  status: SubmissionStatus,
  startAt: Date,
  now: Date,
): boolean {
  return (
    status === 'PUBLISHED' ||
    ((status === 'APPROVED' || status === 'SCHEDULED') && startAt <= now)
  );
}
