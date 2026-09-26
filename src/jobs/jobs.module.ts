import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from '../audit/audit.module.js';
import { CommonModule } from '../common/common.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AssetCleanupJob } from './asset-cleanup.job.js';
import { SchedulerService } from './scheduler.service.js';
import { SubmissionStatusJob } from './submission-status.job.js';

@Module({
  imports: [ScheduleModule.forRoot(), AuditModule, CommonModule, StorageModule],
  providers: [SubmissionStatusJob, AssetCleanupJob, SchedulerService],
  exports: [SubmissionStatusJob, AssetCleanupJob, SchedulerService],
})
export class JobsModule {}
