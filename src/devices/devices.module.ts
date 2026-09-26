import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { TargetGroupsModule } from '../target-groups/target-groups.module.js';
import { DeviceAuthGuard } from './auth/device-auth.js';
import {
  DeviceRuntimeController,
  DevicesController,
} from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({
  imports: [AuditModule, TargetGroupsModule],
  controllers: [DevicesController, DeviceRuntimeController],
  providers: [DevicesService, DeviceAuthGuard],
  exports: [DevicesService, DeviceAuthGuard],
})
export class DevicesModule {}
