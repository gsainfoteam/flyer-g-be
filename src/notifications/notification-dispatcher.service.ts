import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import {
  deviceAlertStates,
  devices,
  groupLineups,
  slackDeliveryState,
  slackNotifications,
} from '../db/schema.js';
import { deviceStatusOf } from '../devices/device-status.js';
import { DEFAULT_LINEUP_SETTINGS } from '../lineups/lineup-schema.js';
import { resolveSettings } from '../lineups/resolve-lineup.js';
import {
  SlackDeliveryError,
  SlackNotificationService,
} from './slack-notification.service.js';

type Notification = typeof slackNotifications.$inferSelect;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 60_000; // Webhook 요청 제한(10초)보다 길다.

@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly slack: SlackNotificationService,
  ) {}

  /** 한 번에 하나. DB 리스로 파드 간 발송을 직렬화하고 커밋 후 외부 요청을 한다. */
  async run(now = new Date()): Promise<Record<string, number> | null> {
    if (!this.slack.enabled) return null;
    const started = Date.now();
    const notification = await this.claim(now);
    if (!notification) return null;
    let status: Notification['status'] = 'SENT';
    let error: SlackDeliveryError | undefined;
    try {
      if (await this.isRelevant(notification, now)) {
        await this.slack.send({
          kind: notification.kind,
          text: notification.text,
          presentation: notification.presentation,
        });
      } else {
        status = 'CANCELED';
      }
    } catch (cause) {
      error =
        cause instanceof SlackDeliveryError
          ? cause
          : new SlackDeliveryError('NOTIFICATION_INTERNAL_ERROR', true);
      status =
        error.retryable && notification.attempts < MAX_ATTEMPTS
          ? 'PENDING'
          : 'FAILED';
      this.logger.warn(
        `notification ${notification.id}: ${error.code} (attempt ${notification.attempts}, ${status})`,
      );
    }
    const finishedAt = new Date(now.getTime() + Date.now() - started);
    const retryDelay = Math.max(
      error?.retryAfterMs ?? 0,
      60_000 * 2 ** (notification.attempts - 1),
    );
    await this.db.transaction(async (tx) => {
      // 리스를 잃은 이전 작업은 새 작업의 결과를 덮어쓰지 않는다.
      const owned = await tx
        .update(slackDeliveryState)
        .set({
          claimToken: null,
          lockedUntil: finishedAt,
          nextSendAt: new Date(
            finishedAt.getTime() + Math.max(1100, error?.retryAfterMs ?? 0),
          ),
        })
        .where(
          and(
            eq(slackDeliveryState.id, 'slack'),
            eq(slackDeliveryState.claimToken, notification.claimToken!),
          ),
        )
        .returning({ id: slackDeliveryState.id });
      if (owned.length === 0) return;
      await tx
        .update(slackNotifications)
        .set({
          status,
          claimToken: null,
          lastError: error?.code ?? null,
          sentAt: status === 'SENT' ? finishedAt : null,
          availableAt:
            status === 'PENDING'
              ? new Date(finishedAt.getTime() + retryDelay)
              : notification.availableAt,
        })
        .where(
          and(
            eq(slackNotifications.id, notification.id),
            eq(slackNotifications.claimToken, notification.claimToken!),
          ),
        );
    });
    return {
      sent: Number(status === 'SENT'),
      failed: Number(status === 'FAILED'),
      retried: Number(status === 'PENDING'),
      canceled: Number(status === 'CANCELED'),
    };
  }

  private claim(now: Date): Promise<Notification | null> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(slackDeliveryState)
        .values({ id: 'slack', lockedUntil: now, nextSendAt: now })
        .onConflictDoNothing();
      const claimToken = randomUUID();
      const lease = await tx
        .update(slackDeliveryState)
        .set({ claimToken, lockedUntil: new Date(now.getTime() + LEASE_MS) })
        .where(
          and(
            eq(slackDeliveryState.id, 'slack'),
            lte(slackDeliveryState.lockedUntil, now),
            lte(slackDeliveryState.nextSendAt, now),
          ),
        )
        .returning({ id: slackDeliveryState.id });
      if (lease.length === 0) return null;

      await tx
        .update(slackNotifications)
        .set({
          status: 'CANCELED',
          claimToken: null,
          lastError: 'NOTIFICATION_EXPIRED',
        })
        .where(
          and(
            inArray(slackNotifications.status, ['PENDING', 'SENDING']),
            lte(slackNotifications.expiresAt, now),
          ),
        );
      const [row] = await tx
        .select()
        .from(slackNotifications)
        .where(
          and(
            inArray(slackNotifications.status, ['PENDING', 'SENDING']),
            lte(slackNotifications.availableAt, now),
          ),
        )
        .orderBy(asc(slackNotifications.createdAt), asc(slackNotifications.id))
        .limit(1);
      if (!row || row.attempts >= MAX_ATTEMPTS) {
        if (row)
          await tx
            .update(slackNotifications)
            .set({
              status: 'FAILED',
              claimToken: null,
              lastError: 'NOTIFICATION_ATTEMPTS_EXHAUSTED',
            })
            .where(eq(slackNotifications.id, row.id));
        await tx
          .update(slackDeliveryState)
          .set({
            claimToken: null,
            lockedUntil: now,
            nextSendAt: new Date(now.getTime() + 1100),
          })
          .where(eq(slackDeliveryState.id, 'slack'));
        return null;
      }
      const [claimed] = await tx
        .update(slackNotifications)
        .set({ status: 'SENDING', claimToken, attempts: row.attempts + 1 })
        .where(eq(slackNotifications.id, row.id))
        .returning();
      return claimed;
    });
  }

  private async isRelevant(
    notification: Notification,
    now: Date,
  ): Promise<boolean> {
    if (!this.slack.enabledFor(notification.kind)) return false;
    if (notification.kind !== 'DEVICE_OFFLINE') return true;
    const [row] = await this.db
      .select({
        device: devices,
        state: deviceAlertStates,
        settings: groupLineups.settings,
      })
      .from(devices)
      .innerJoin(deviceAlertStates, eq(deviceAlertStates.deviceId, devices.id))
      .leftJoin(groupLineups, eq(groupLineups.groupId, devices.programGroupId))
      .where(eq(devices.id, notification.deviceId!));
    return (
      !!row &&
      row.state.incidentId === notification.incidentId &&
      row.device.lastSeenAt?.getTime() ===
        row.state.observedLastSeenAt?.getTime() &&
      deviceStatusOf(
        row.device,
        resolveSettings(
          row.settings ?? DEFAULT_LINEUP_SETTINGS,
          row.device.lineupOverrides,
        ),
        now,
      ) === 'OFFLINE'
    );
  }
}
