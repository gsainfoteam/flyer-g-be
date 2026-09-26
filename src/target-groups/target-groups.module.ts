import { Module } from '@nestjs/common';
import { TargetGroupsController } from './target-groups.controller.js';
import { TargetGroupsService } from './target-groups.service.js';

@Module({
  controllers: [TargetGroupsController],
  providers: [TargetGroupsService],
  exports: [TargetGroupsService],
})
export class TargetGroupsModule {}
