import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { MailService, mailDeliveryError } from './mail.service.js';
import { reviewMail } from './review-mail.js';

const smtp = vi.hoisted(() => ({
  sendMail: vi.fn(),
  close: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock('nodemailer', () => ({ createTransport: smtp.createTransport }));
const password = randomBytes(24).toString('hex');
const settings = {
  MAIL_USER: 'sender@example.com',
  MAIL_APP_PASSWORD: password,
  MAIL_FROM_NAME: 'Flyer G',
  MAIL_REVIEW_REMINDER_TO: 'admin@gist-house.org',
  MAIL_REVIEW_REMINDERS_ENABLED: true,
};
const message = {
  recipient: settings.MAIL_REVIEW_REMINDER_TO,
  subject: '승인 안내',
  html: '<p>승인 안내</p>',
  text: '승인 안내',
  messageId: '<test@flyer-g.gistory.me>',
};

beforeEach(() => {
  vi.clearAllMocks();
  smtp.createTransport.mockReturnValue(smtp);
  smtp.sendMail.mockResolvedValue({ accepted: [message.recipient] });
});

it('발신 정보와 HTML/텍스트를 전달하고 SMTP 전체 요청 시간을 제한한다', async () => {
  const service = new MailService(new ConfigService(settings));
  await service.send(message);
  expect(smtp.createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      service: 'gmail',
      auth: { user: settings.MAIL_USER, pass: password },
    }),
  );
  expect(smtp.sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      to: message.recipient,
      from: { name: 'Flyer G', address: settings.MAIL_USER },
      html: message.html,
      text: message.text,
      messageId: message.messageId,
      signal: expect.any(AbortSignal),
    }),
  );
  service.onModuleDestroy();
  expect(smtp.close).toHaveBeenCalledOnce();
});

it('발신 별칭을 지정할 수 있다', async () => {
  await new MailService(
    new ConfigService({ ...settings, MAIL_FROM_ADDRESS: 'alias@example.com' }),
  ).send(message);
  expect(smtp.sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      from: { name: 'Flyer G', address: 'alias@example.com' },
    }),
  );
});

it('비활성 상태는 연결도 하지 않고 발송 성공으로 처리하지 않는다', async () => {
  const service = new MailService(
    new ConfigService({ ...settings, MAIL_REVIEW_REMINDERS_ENABLED: false }),
  );
  await expect(service.send(message)).rejects.toThrow('MAIL_DISABLED');
  expect(smtp.createTransport).not.toHaveBeenCalled();
  expect(smtp.sendMail).not.toHaveBeenCalled();
});

it.each([
  [{ responseCode: 451 }, true, 'MAIL_SMTP_451'],
  [{ responseCode: 550 }, false, 'MAIL_SMTP_550'],
  [{ code: 'EAUTH' }, false, 'MAIL_AUTH_FAILED'],
  [{ code: 'ETIMEDOUT' }, true, 'MAIL_TRANSPORT_ERROR'],
])(
  '오류를 재시도 여부와 안전한 코드로 변환한다 (%j)',
  (cause, retryable, code) => {
    const error = mailDeliveryError({ ...cause, message: password });
    expect(error).toMatchObject({ code, retryable });
    expect(String(error)).not.toContain(password);
  },
);

it('수신 거부를 성공으로 기록하지 않는다', async () => {
  smtp.sendMail.mockResolvedValue({
    accepted: [],
    rejected: [message.recipient],
  });
  await expect(
    new MailService(new ConfigService(settings)).send(message),
  ).rejects.toThrow('MAIL_RECIPIENT_REJECTED');
});

it('메일에는 동일한 집계 값과 승인 링크, 한국 시간 기준 시각을 담는다', () => {
  const content = reviewMail(
    [
      {
        type: 'POSTER',
        pendingReview: 2,
        oldestSubmittedAt: new Date('2035-11-04T23:00:00Z'),
      },
      {
        type: 'STORY',
        pendingReview: 1,
        oldestSubmittedAt: new Date('2035-11-05T00:00:00Z'),
      },
    ],
    new Date('2035-11-05T01:00:00Z'),
  );
  expect(content.subject).toBe('[Flyer G] 승인 대기 요청이 3건 있습니다');
  for (const body of [content.text, content.html]) {
    expect(body).toContain('포스터 2건 · 이벤트 배너 0건 · 제보 1건');
    expect(body).toContain('대기 2시간 0분');
    expect(body).toContain('10:00:00');
    expect(body).toContain('https://flyer-g.gistory.me/review');
  }
});
