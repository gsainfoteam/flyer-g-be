/** 재시도할 때도 최초 알림과 같은 디자인·집계 값을 사용하도록 DB에 저장한다. */
export type NotificationPresentation = {
  title: string;
  color: string;
  /** 서버가 만드는 요약 문구. Slack mrkdwn 형식이며 사용자 입력을 넣지 않는다. */
  summary: string;
  fields: { label: string; value: string }[];
  context: string;
};

const NOTIFICATION_ACTIONS = {
  DEVICE_OFFLINE: {
    label: '기기 상태 확인하기',
    url: 'https://flyer-g.gistory.me/tv',
  },
  REVIEW_REMINDER: {
    label: '승인 요청 확인하기',
    url: 'https://flyer-g.gistory.me/review',
  },
} as const;

export type NotificationMessage = {
  kind: keyof typeof NOTIFICATION_ACTIONS;
  /** 푸시 알림·스크린리더용 전체 텍스트. */
  text: string;
  presentation?: NotificationPresentation | null;
};

/** 사용자 입력의 링크·채널·사용자 멘션 구문을 비활성화한다. */
function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function slackPayload(message: NotificationMessage) {
  const card = message.presentation;
  // 표시 문구나 저장된 디자인이 아니라 알림 종류로 링크를 결정한다.
  const destination = NOTIFICATION_ACTIONS[message.kind];
  const action = {
    type: 'actions',
    elements: [
      {
        type: 'button',
        action_id: 'open_admin',
        text: {
          type: 'plain_text',
          text: destination.label,
          emoji: true,
        },
        url: destination.url,
      },
    ],
  };
  const base = {
    text: message.text,
    mrkdwn: false,
    parse: 'none',
    unfurl_links: false,
    unfurl_media: false,
  };

  // 이미 대기 중인 이전 형식의 알림도 계속 보낼 수 있다.
  if (!card)
    return {
      ...base,
      blocks: [
        { type: 'section', text: { type: 'plain_text', text: message.text } },
        action,
      ],
    };

  return {
    ...base,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: card.title, emoji: true },
      },
    ],
    // 색상 바는 attachment가 담당하고 내부 레이아웃은 Block Kit로 구성한다.
    attachments: [
      {
        color: card.color,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: card.summary, verbatim: true },
          },
          {
            type: 'section',
            fields: card.fields.map(({ label, value }) => ({
              type: 'mrkdwn',
              text: `*${escapeText(label)}*\n${escapeText(value)}`,
              verbatim: true,
            })),
          },
          {
            type: 'context',
            elements: [{ type: 'plain_text', text: card.context }],
          },
          action,
        ],
      },
    ],
  };
}
