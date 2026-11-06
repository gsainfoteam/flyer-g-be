import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AssetsModule } from '../assets/assets.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CommonModule } from '../common/common.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AssetCleanupJob } from './asset-cleanup.job.js';
import { PlayEventAggregationJob } from './play-event-aggregation.job.js';
import { SchedulerService } from './scheduler.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DeviceOfflineAlertJob } from './device-offline-alert.job.js';
import { ReviewReminderJob } from './review-reminder.job.js';
import { SubmissionStatusJob } from './submission-status.job.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    NotificationsModule,
    AssetsModule,
    AuditModule,
    CommonModule,
    RealtimeModule,
    StorageModule,
  ],
  providers: [
    DeviceOfflineAlertJob,
    ReviewReminderJob,
    SubmissionStatusJob,
    AssetCleanupJob,
    PlayEventAggregationJob,
    SchedulerService,
  ],
  exports: [
    DeviceOfflineAlertJob,
    ReviewReminderJob,
    SubmissionStatusJob,
    AssetCleanupJob,
    PlayEventAggregationJob,
    SchedulerService,
  ],
})
export class JobsModule {}
