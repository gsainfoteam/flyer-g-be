import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { VideoProcessingService } from './video-processing.service.js';

@Module({
  imports: [StorageModule],
  controllers: [AssetsController],
  providers: [AssetsService, VideoProcessingService],
  exports: [AssetsService, VideoProcessingService],
})
export class AssetsModule {}
