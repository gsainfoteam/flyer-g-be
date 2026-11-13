import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { mailNotifications, slackNotifications } from '../db/schema.js';
import { MailService } from '../notifications/mail.service.js';
import { reviewMail } from '../notifications/review-mail.js';
import { pendingReviewSummary } from '../submissions/review-summary.js';
import {
  reviewMessage,
  reviewReminderSlot,
} from '../notifications/notification-messages.js';
import { SlackNotificationService } from '../notifications/slack-notification.service.js';
import { JobLock, withJobLock } from './job-lock.js';

@Injectable()
export class ReviewReminderJob {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly slack: SlackNotificationService,
    private readonly mail: MailService,
  ) {}

  async run(now = new Date()): Promise<{ queued: number } | null> {
    const slot = reviewReminderSlot(now);
    const slackEnabled = this.slack.enabledFor('REVIEW_REMINDER');
    if (!slot || (!slackEnabled && !this.mail.enabled)) return null;
    return withJobLock(this.db, JobLock.REVIEW_REMINDER, async (tx) => {
      const rows = await pendingReviewSummary(tx);
      if (rows.length === 0) return { queued: 0 };
      let queued = 0;
      if (slackEnabled) {
        const inserted = await tx
          .insert(slackNotifications)
          .values({
            dedupeKey: `review:${slot}`,
            ...reviewMessage(rows, now),
            availableAt: now,
            expiresAt: new Date(now.getTime() + 3600_000),
            createdAt: now,
          })
          .onConflictDoNothing({ target: slackNotifications.dedupeKey })
          .returning({ id: slackNotifications.id });
        queued += inserted.length;
      }
      if (this.mail.enabled) {
        const inserted = await tx
          .insert(mailNotifications)
          .values({
            dedupeKey: `review:${slot}:${this.mail.recipient}`,
            recipient: this.mail.recipient,
            ...reviewMail(rows, now),
            availableAt: now,
            expiresAt: new Date(now.getTime() + 3600_000),
            createdAt: now,
          })
          .onConflictDoNothing({ target: mailNotifications.dedupeKey })
          .returning({ id: mailNotifications.id });
        queued += inserted.length;
      }
      return { queued };
    });
  }
}
