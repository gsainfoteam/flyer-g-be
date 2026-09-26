import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module.js';
import { DeviceTelemetryController } from './device-telemetry.controller.js';
import { DeviceTelemetryService } from './device-telemetry.service.js';

@Module({
  imports: [DevicesModule],
  controllers: [DeviceTelemetryController],
  providers: [DeviceTelemetryService],
})
export class DeviceTelemetryModule {}
