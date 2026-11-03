import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ProgramsController } from './programs.controller.js';
import { ProgramsService } from './programs.service.js';

@Module({
  imports: [AuditModule, RealtimeModule],
  controllers: [ProgramsController],
  providers: [ProgramsService],
})
export class ProgramsModule {}
