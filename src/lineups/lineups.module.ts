import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { LineupsController } from './lineups.controller.js';
import { LineupsService } from './lineups.service.js';

@Module({
  imports: [AuditModule, RealtimeModule],
  controllers: [LineupsController],
  providers: [LineupsService],
  exports: [LineupsService],
})
export class LineupsModule {}
