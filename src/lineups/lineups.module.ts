import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { LineupsController } from './lineups.controller.js';
import { LineupsService } from './lineups.service.js';

@Module({
  imports: [AuditModule],
  controllers: [LineupsController],
  providers: [LineupsService],
  exports: [LineupsService],
})
export class LineupsModule {}
