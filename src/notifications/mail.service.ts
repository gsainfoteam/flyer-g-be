import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export type MailMessage = {
  recipient: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
};

export class MailDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

/** SMTP 응답 원문에는 주소 등이 포함되므로 안전한 코드만 기록한다. */
export function mailDeliveryError(cause: unknown): MailDeliveryError {
  if (cause instanceof MailDeliveryError) return cause;
  const error = cause as { code?: string; responseCode?: number } | null;
  const response = error?.responseCode;
  if (response && response >= 400 && response < 600)
    return new MailDeliveryError(`MAIL_SMTP_${response}`, response < 500);
  if (error?.code === 'EAUTH')
    return new MailDeliveryError('MAIL_AUTH_FAILED', false);
  if (error?.code === 'EENVELOPE')
    return new MailDeliveryError('MAIL_RECIPIENT_REJECTED', false);
  return new MailDeliveryError('MAIL_TRANSPORT_ERROR', true);
}

@Injectable()
export class MailService implements OnModuleDestroy {
  readonly enabled: boolean;
  readonly recipient: string;
  private readonly transporter?: Transporter;
  private readonly from: { name: string; address: string };

  constructor(config: ConfigService<Env, true>) {
    this.enabled = config.get('MAIL_REVIEW_REMINDERS_ENABLED', { infer: true });
    this.recipient = config.get('MAIL_REVIEW_REMINDER_TO', { infer: true });
    const user = config.get('MAIL_USER', { infer: true });
    this.from = {
      name: config.get('MAIL_FROM_NAME', { infer: true }),
      address: config.get('MAIL_FROM_ADDRESS', { infer: true }) ?? user ?? '',
    };
    if (this.enabled) {
      this.transporter = createTransport({
        service: 'gmail',
        auth: { user, pass: config.get('MAIL_APP_PASSWORD', { infer: true }) },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) throw new MailDeliveryError('MAIL_DISABLED', false);
    try {
      // SMTP 전체 요청을 제한한다. DB 리스(120초)보다 먼저 연결을 닫는다.
      const info = await this.transporter.sendMail({
        from: this.from,
        to: message.recipient,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId: message.messageId,
        signal: AbortSignal.timeout(60_000),
      });
      if (!info.accepted?.length)
        throw new MailDeliveryError('MAIL_RECIPIENT_REJECTED', false);
    } catch (error) {
      throw mailDeliveryError(error);
    }
  }

  onModuleDestroy(): void {
    this.transporter?.close();
  }
}
