import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';
import { AuditService } from './audit.service.js';

@Module({
  controllers: [AuditLogsController],
  providers: [AuditService, AuditLogsService],
  exports: [AuditService],
})
export class AuditModule {}
