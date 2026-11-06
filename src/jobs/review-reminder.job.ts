import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { slackNotifications } from '../db/schema.js';
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
  ) {}

  async run(now = new Date()): Promise<{ queued: number } | null> {
    const slot = reviewReminderSlot(now);
    if (!slot || !this.slack.enabledFor('REVIEW_REMINDER')) return null;
    return withJobLock(this.db, JobLock.REVIEW_REMINDER, async (tx) => {
      const rows = await pendingReviewSummary(tx);
      if (rows.length === 0) return { queued: 0 };
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
      return { queued: inserted.length };
    });
  }
}
