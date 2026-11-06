import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import {
  deviceAlertStates,
  devices,
  groupLineups,
  slackNotifications,
} from '../db/schema.js';
import { DEFAULT_LINEUP_SETTINGS } from '../lineups/lineup-schema.js';
import { resolveSettings } from '../lineups/resolve-lineup.js';
import { evaluateDeviceAlert } from '../notifications/device-alert-policy.js';
import { offlineMessage } from '../notifications/notification-messages.js';
import { SlackNotificationService } from '../notifications/slack-notification.service.js';
import { JobLock, withJobLock } from './job-lock.js';

@Injectable()
export class DeviceOfflineAlertJob {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly slack: SlackNotificationService,
  ) {}

  async run(now = new Date()): Promise<{ queued: number } | null> {
    if (!this.slack.enabledFor('DEVICE_OFFLINE')) return null;
    return withJobLock(this.db, JobLock.DEVICE_OFFLINE_ALERT, async (tx) => {
      const rows = await tx
        .select({
          device: devices,
          settings: groupLineups.settings,
          previous: deviceAlertStates,
        })
        .from(devices)
        .leftJoin(
          groupLineups,
          eq(groupLineups.groupId, devices.programGroupId),
        )
        .leftJoin(
          deviceAlertStates,
          eq(deviceAlertStates.deviceId, devices.id),
        );
      let queued = 0;
      for (const { device, settings, previous } of rows) {
        const result = evaluateDeviceAlert(
          device,
          resolveSettings(
            settings ?? DEFAULT_LINEUP_SETTINGS,
            device.lineupOverrides,
          ),
          previous ?? undefined,
          now,
        );
        if (result.shouldAlert) {
          const incidentId = randomUUID();
          result.state.incidentId = incidentId;
          await tx.insert(slackNotifications).values({
            dedupeKey: `device:${device.id}:${incidentId}`,
            deviceId: device.id,
            incidentId,
            ...offlineMessage(device, now),
            availableAt: now,
            expiresAt: new Date(now.getTime() + 3600_000),
            createdAt: now,
          });
          queued++;
        }
        await tx
          .insert(deviceAlertStates)
          .values(result.state)
          .onConflictDoUpdate({
            target: deviceAlertStates.deviceId,
            set: result.state,
          });
      }
      return { queued };
    });
  }
}
