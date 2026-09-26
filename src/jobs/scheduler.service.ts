import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import type { Env } from '../config/env.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { AssetCleanupJob } from './asset-cleanup.job.js';
import { JobLock, withJobLock } from './job-lock.js';
import { SubmissionStatusJob } from './submission-status.job.js';

/**
 * 주기 작업의 시간표. 작업 내용은 각 Job 클래스에 있고, 여기서는 켜져 있는지 확인하고 부르기만 한다.
 * 실패해도 서버는 계속 돈다. 다음 주기에 다시 시도한다.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly enabled: boolean;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly submissionStatusJob: SubmissionStatusJob,
    private readonly assetCleanupJob: AssetCleanupJob,
    private readonly idempotencyService: IdempotencyService,
  ) {
    this.enabled = config.get('SCHEDULER_ENABLED', { infer: true });
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'submission-status' })
  async syncSubmissionStatus(): Promise<void> {
    await this.runJob('submission-status', () =>
      this.submissionStatusJob.run(),
    );
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'asset-cleanup' })
  async cleanupAssets(): Promise<void> {
    await this.runJob('asset-cleanup', () => this.assetCleanupJob.run());
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'idempotency-cleanup' })
  async cleanupIdempotencyKeys(): Promise<void> {
    await this.runJob('idempotency-cleanup', () =>
      withJobLock(this.db, JobLock.IDEMPOTENCY_CLEANUP, async (tx) => ({
        deleted: await this.idempotencyService.deleteExpired(tx, new Date()),
      })),
    );
  }

  private async runJob(
    name: string,
    run: () => Promise<Record<string, number> | null>,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      const result = await run();
      // 다른 파드가 돌고 있으면 null. 바뀐 것이 있을 때만 남긴다.
      if (result && Object.values(result).some((count) => count > 0)) {
        this.logger.log(`${name}: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      this.logger.error(`${name} failed`, error);
    }
  }
}
