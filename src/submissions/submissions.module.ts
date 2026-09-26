import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { TargetGroupsModule } from '../target-groups/target-groups.module.js';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';

@Module({
  imports: [AssetsModule, AuditModule, CategoriesModule, TargetGroupsModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
