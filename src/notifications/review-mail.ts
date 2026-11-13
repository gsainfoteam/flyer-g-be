import type { pendingReviewSummary } from '../submissions/review-summary.js';
import { reviewMessage } from './notification-messages.js';

const REVIEW_URL = 'https://flyer-g.gistory.me/review';
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Slack과 같은 집계/문구를 사용하고 메일용 레이아웃만 입힌다. */
export function reviewMail(
  rows: Awaited<ReturnType<typeof pendingReviewSummary>>,
  now: Date,
) {
  const summary = reviewMessage(rows, now);
  const [heading, counts, oldest, timestamp] = summary.text.split('\n');
  return {
    subject: `[Flyer G] ${heading.replace(/\.$/, '')}`,
    text: `${summary.text}\n\n승인 요청 확인하기: ${REVIEW_URL}`,
    html: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#f4f6f8;color:#202124;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px"><tr><td style="padding:32px;border-top:4px solid #2eb67d">
<p style="margin:0 0 24px;color:#16845a;font-weight:bold">Flyer G · 승인 요청 안내</p>
<h1 style="font-size:24px;line-height:1.5;margin:0 0 16px">${escapeHtml(heading)}</h1>
<p style="font-size:16px;line-height:1.8">${escapeHtml(counts)}</p>
<p style="font-size:14px;line-height:1.8;color:#5f6368">${escapeHtml(oldest)}</p>
<p style="margin:28px 0"><a href="${REVIEW_URL}" style="display:inline-block;padding:14px 22px;background:#16845a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">승인 요청 확인하기</a></p>
<p style="font-size:12px;color:#5f6368;line-height:1.7">${escapeHtml(timestamp)}<br>평일 오전 10시·오후 4시에 승인 대기 요청이 있을 때 발송됩니다.<br>현재 대기 건수는 관리 화면에서 확인해 주세요.</p>
</td></tr></table></td></tr></table></body></html>`,
  };
}
