import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { LineupsModule } from '../lineups/lineups.module.js';
import { LiveModule } from '../live/live.module.js';
import {
  PlaylistController,
  PlaylistPreviewController,
} from './playlist.controller.js';
import { PlaylistService } from './playlist.service.js';

@Module({
  imports: [AssetsModule, DevicesModule, LineupsModule, LiveModule],
  controllers: [PlaylistController, PlaylistPreviewController],
  providers: [PlaylistService],
})
export class PlaylistModule {}
