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
import { HealthModule } from './health/health.module.js';
import { PolicyModule } from './policy/policy.module.js';
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
    AssetsModule,
    SubmissionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
