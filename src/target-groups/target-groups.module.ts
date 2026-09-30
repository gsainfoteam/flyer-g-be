import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { TargetGroupsController } from './target-groups.controller.js';
import { TargetGroupsService } from './target-groups.service.js';

@Module({
  imports: [AuditModule],
  controllers: [TargetGroupsController],
  providers: [TargetGroupsService],
  exports: [TargetGroupsService],
})
export class TargetGroupsModule {}
