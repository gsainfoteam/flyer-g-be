import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lte, or } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { mailNotifications } from '../db/schema.js';
import { MailService, mailDeliveryError } from './mail.service.js';

const MAX_ATTEMPTS = 5;
const LEASE_MS = 120_000;

@Injectable()
export class MailDispatcher {
  private readonly logger = new Logger(MailDispatcher.name);

  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly mail: MailService,
  ) {}

  async run(now = new Date()): Promise<Record<string, number> | null> {
    if (!this.mail.enabled) return null;
    const started = Date.now();
    const row = await this.claim(now);
    if (!row) return null;
    let status: typeof row.status = 'SENT';
    let lastError: string | null = null;
    try {
      await this.mail.send({ ...row, messageId: row.messageId! });
    } catch (cause) {
      const error = mailDeliveryError(cause);
      lastError = error.code;
      status =
        error.retryable && row.attempts < MAX_ATTEMPTS ? 'PENDING' : 'FAILED';
      this.logger.warn(
        `mail ${row.id}: ${error.code} (attempt ${row.attempts}, ${status})`,
      );
    }
    const finishedAt = new Date(now.getTime() + Date.now() - started);
    // 리스를 회수한 새 작업의 결과를 이전 작업이 덮어쓰지 않는다.
    const settled = await this.db
      .update(mailNotifications)
      .set({
        status,
        claimToken: null,
        lockedUntil: null,
        lastError,
        sentAt: status === 'SENT' ? finishedAt : null,
        availableAt:
          status === 'PENDING'
            ? new Date(finishedAt.getTime() + 60_000 * 2 ** (row.attempts - 1))
            : row.availableAt,
      })
      .where(
        and(
          eq(mailNotifications.id, row.id),
          eq(mailNotifications.claimToken, row.claimToken!),
        ),
      )
      .returning({ id: mailNotifications.id });
    if (!settled.length) return null;
    return {
      sent: Number(status === 'SENT'),
      failed: Number(status === 'FAILED'),
      retried: Number(status === 'PENDING'),
    };
  }

  private async claim(now: Date) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(mailNotifications)
        .where(
          and(
            or(
              eq(mailNotifications.status, 'PENDING'),
              and(
                eq(mailNotifications.status, 'SENDING'),
                lte(mailNotifications.lockedUntil, now),
              ),
            ),
            lte(mailNotifications.availableAt, now),
          ),
        )
        .orderBy(asc(mailNotifications.createdAt), asc(mailNotifications.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return null;
      const canceled =
        row.expiresAt <= now || row.recipient !== this.mail.recipient;
      if (canceled || row.attempts >= MAX_ATTEMPTS) {
        await tx
          .update(mailNotifications)
          .set({
            status: canceled ? 'CANCELED' : 'FAILED',
            claimToken: null,
            lockedUntil: null,
            lastError:
              row.expiresAt <= now
                ? 'MAIL_EXPIRED'
                : canceled
                  ? 'MAIL_RECIPIENT_CHANGED'
                  : 'MAIL_ATTEMPTS_EXHAUSTED',
          })
          .where(eq(mailNotifications.id, row.id));
        return null;
      }
      const [claimed] = await tx
        .update(mailNotifications)
        .set({
          status: 'SENDING',
          attempts: row.attempts + 1,
          claimToken: randomUUID(),
          lockedUntil: new Date(now.getTime() + LEASE_MS),
          messageId: row.messageId ?? `<${row.id}@flyer-g.gistory.me>`,
        })
        .where(eq(mailNotifications.id, row.id))
        .returning();
      return claimed;
    });
  }
}
