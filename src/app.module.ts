import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AssetsModule } from './assets/assets.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { CommonModule } from './common/common.module.js';
import { validateEnv } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { DeviceTelemetryModule } from './device-telemetry/device-telemetry.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { ProgramsModule } from './programs/programs.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PlaylistModule } from './playlist/playlist.module.js';
import { PolicyModule } from './policy/policy.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { StatsModule } from './stats/stats.module.js';
import { LineupsModule } from './lineups/lineups.module.js';
import { LiveModule } from './live/live.module.js';
import { StoriesModule } from './stories/stories.module.js';
import { SubmissionsModule } from './submissions/submissions.module.js';
import { TargetGroupsModule } from './target-groups/target-groups.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DbModule,
    CommonModule,
    HealthModule,
    AuthModule,
    PolicyModule,
    CategoriesModule,
    TargetGroupsModule,
    LineupsModule,
    LiveModule,
    ProgramsModule,
    AssetsModule,
    SubmissionsModule,
    StoriesModule,
    ReviewsModule,
    DevicesModule,
    PlaylistModule,
    DeviceTelemetryModule,
    JobsModule,
    StatsModule,
    // TV 실시간 연결(제어 채널·게임 중계). 편성을 바꾸는 모듈도 알림 때문에 가져다 쓴다.
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
