import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { offlineMessage, reviewMessage } from './notification-messages.js';
import {
  SlackDeliveryError,
  SlackNotificationService,
} from './slack-notification.service.js';

const config = {
  SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test',
  SLACK_DEVICE_ALERTS_ENABLED: true,
  SLACK_REVIEW_REMINDERS_ENABLED: true,
};
const makeService = (values = config) =>
  new SlackNotificationService(
    new ConfigService(values) as ConfigService<Env, true>,
  );

afterEach(() => vi.unstubAllGlobals());

it('웹훅이 없으면 비활성화된다', () => {
  expect(makeService({ ...config, SLACK_WEBHOOK_URL: '' }).enabled).toBe(false);
  expect(
    makeService({ ...config, SLACK_DEVICE_ALERTS_ENABLED: false }).enabledFor(
      'DEVICE_OFFLINE',
    ),
  ).toBe(false);
});

it('관리자 URL과 plain text로 보내며 사용자 입력을 멘션으로 해석하지 않는다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
  vi.stubGlobal('fetch', fetchMock);
  await makeService().send({ kind: 'DEVICE_OFFLINE', text: '<!channel> TV' });
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(config.SLACK_WEBHOOK_URL);
  expect(options.redirect).toBe('error');
  const payload = JSON.parse(options.body);
  expect(payload.mrkdwn).toBe(false);
  expect(payload.blocks[0].text).toEqual({
    type: 'plain_text',
    text: '<!channel> TV',
  });
  expect(payload.blocks[1].elements[0].url).toBe(
    'https://flyer-g.gistory.me/tv',
  );
});

it('TV 장애는 빨간색 바와 Block Kit 필드로 전송하고 사용자 입력의 멘션을 이스케이프한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
  vi.stubGlobal('fetch', fetchMock);
  const now = new Date('2026-11-06T01:00:00Z');
  const message = offlineMessage(
    {
      name: '<!channel> & TV',
      location: '<https://example.com|로비>',
      lastSeenAt: new Date(now.getTime() - 120_000),
    },
    now,
  );
  await makeService().send(message);
  const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(payload.text).toBe(message.text);
  expect(payload.mrkdwn).toBe(false);
  expect(payload.parse).toBe('none');
  expect(payload.blocks[0]).toMatchObject({
    type: 'header',
    text: { type: 'plain_text', text: '📺 TV 연결 끊김' },
  });
  const attachment = payload.attachments[0];
  expect(attachment.color).toBe('#E01E5A');
  expect(attachment.blocks[0].text.text).toContain('*2분 동안 응답이 없어요.*');
  expect(attachment.blocks[1].fields[0]).toEqual({
    type: 'mrkdwn',
    text: '*기기*\n&lt;!channel&gt; &amp; TV',
    verbatim: true,
  });
  expect(attachment.blocks[1].fields[1].text).toBe(
    '*위치*\n&lt;https://example.com|로비&gt;',
  );
  expect(attachment.blocks[2].type).toBe('context');
  expect(attachment.blocks[3].elements[0]).toMatchObject({
    url: 'https://flyer-g.gistory.me/tv',
    text: { text: '기기 상태 확인하기' },
  });
});

it('승인 리마인드는 초록색 바와 강조된 합계·종류별 건수로 전송한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
  vi.stubGlobal('fetch', fetchMock);
  const message = reviewMessage(
    [
      {
        type: 'POSTER',
        pendingReview: 7,
        oldestSubmittedAt: new Date('2026-11-04T01:00:00Z'),
      },
      {
        type: 'EVENT_BANNER',
        pendingReview: 3,
        oldestSubmittedAt: new Date('2026-11-05T01:00:00Z'),
      },
      {
        type: 'STORY',
        pendingReview: 2,
        oldestSubmittedAt: new Date('2026-11-06T00:00:00Z'),
      },
    ],
    new Date('2026-11-06T01:00:00Z'),
  );
  await makeService().send(message);
  const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(payload.text).toContain('승인 대기 요청이 12건');
  const attachment = payload.attachments[0];
  expect(attachment.color).toBe('#2EB67D');
  expect(attachment.blocks[0].text.text).toContain(
    '*12건의 요청이 승인을 기다리고 있어요.*',
  );
  expect(attachment.blocks[0].text.text).toContain('포스터 *7건*');
  expect(attachment.blocks[1].fields[0].text).toContain('2일');
  expect(attachment.blocks[3].elements[0]).toMatchObject({
    url: 'https://flyer-g.gistory.me/review',
    text: { text: '승인 요청 확인하기' },
  });
});

it.each([
  [429, true, 'SLACK_RATE_LIMITED', 120_000],
  [503, true, 'SLACK_HTTP_503', 0],
  [400, false, 'SLACK_HTTP_400', 0],
  [403, false, 'SLACK_HTTP_403', 0],
])('HTTP %s 실패를 분류한다', async (status, retryable, code, retryAfterMs) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response('secret response', {
        status,
        headers: { 'Retry-After': '120' },
      }),
    ),
  );
  await expect(
    makeService().send({ kind: 'REVIEW_REMINDER', text: 'test' }),
  ).rejects.toMatchObject({
    code,
    retryable,
    retryAfterMs,
  });
});

it('네트워크 오류에서 웹훅 시크릿을 제거한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error(config.SLACK_WEBHOOK_URL)),
  );
  await expect(
    makeService().send({ kind: 'REVIEW_REMINDER', text: 'test' }),
  ).rejects.toEqual(new SlackDeliveryError('SLACK_NETWORK_ERROR', true));
});

it('200이어도 ok 응답이 아니면 성공으로 기록하지 않는다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('invalid_payload')),
  );
  await expect(
    makeService().send({ kind: 'REVIEW_REMINDER', text: 'test' }),
  ).rejects.toMatchObject({
    code: 'SLACK_UNEXPECTED_RESPONSE',
    retryable: false,
  });
});
