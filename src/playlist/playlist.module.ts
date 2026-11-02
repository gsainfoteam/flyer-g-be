import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { LineupsModule } from '../lineups/lineups.module.js';
import { PlaylistController } from './playlist.controller.js';
import { PlaylistService } from './playlist.service.js';

@Module({
  imports: [AssetsModule, DevicesModule, LineupsModule],
  controllers: [PlaylistController],
  providers: [PlaylistService],
})
export class PlaylistModule {}
