import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import {
  slackPayload,
  type NotificationMessage,
} from './notification-presentation.js';

/** URL·응답 본문·원본 fetch 오류에는 시크릿이 섞일 수 있어 저장하거나 로그에 남기지 않는다. */
export class SlackDeliveryError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs = 0,
  ) {
    super(code);
  }
}

@Injectable()
export class SlackNotificationService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get enabled(): boolean {
    return !!this.config.get('SLACK_WEBHOOK_URL', { infer: true });
  }

  enabledFor(kind: NotificationMessage['kind']): boolean {
    return (
      this.enabled &&
      this.config.get(
        kind === 'REVIEW_REMINDER'
          ? 'SLACK_REVIEW_REMINDERS_ENABLED'
          : 'SLACK_DEVICE_ALERTS_ENABLED',
        { infer: true },
      )
    );
  }

  async send(message: NotificationMessage): Promise<void> {
    const url = this.config.get('SLACK_WEBHOOK_URL', { infer: true });
    if (!url) throw new SlackDeliveryError('SLACK_NOT_CONFIGURED', false);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify(slackPayload(message)),
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        throw new SlackDeliveryError(
          'SLACK_RATE_LIMITED',
          true,
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000,
        );
      }
      if (!response.ok) {
        throw new SlackDeliveryError(
          `SLACK_HTTP_${response.status}`,
          response.status >= 500,
        );
      }
      if ((await response.text()).trim() !== 'ok') {
        throw new SlackDeliveryError('SLACK_UNEXPECTED_RESPONSE', false);
      }
    } catch (error) {
      if (error instanceof SlackDeliveryError) throw error;
      throw new SlackDeliveryError('SLACK_NETWORK_ERROR', true);
    }
  }
}
