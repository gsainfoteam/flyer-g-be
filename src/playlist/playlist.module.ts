import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { PlaylistController } from './playlist.controller.js';
import { PlaylistService } from './playlist.service.js';

@Module({
  imports: [AssetsModule, DevicesModule],
  controllers: [PlaylistController],
  providers: [PlaylistService],
})
export class PlaylistModule {}
