import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { devices, playEvents, type Device } from '../db/schema.js';
import type { HeartbeatDto } from './dto/heartbeat.dto.js';
import type {
  PlayEventDto,
  PlayEventsResultDto,
} from './dto/play-events.dto.js';

/** 기기 런타임 보고 (요구사항 9절). 기기는 실패해도 재생을 멈추지 않으므로 가볍게 받는다. */
@Injectable()
export class DeviceTelemetryService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** 최신 상태 하나만 의미가 있어 덮어쓴다. 기기 상태(ONLINE 등)는 서버가 받은 시각으로 판정한다. */
  async heartbeat(device: Device, dto: HeartbeatDto): Promise<void> {
    await this.db
      .update(devices)
      .set({
        lastSeenAt: new Date(),
        appVersion: dto.appVersion,
        resolutionWidth: dto.resolution.width,
        resolutionHeight: dto.resolution.height,
        lastPlaylistVersion: dto.playlistVersion ?? null,
        lastRenderOkAt: dto.lastRenderOkAt
          ? new Date(dto.lastRenderOkAt)
          : null,
      })
      .where(eq(devices.id, device.id));
  }

  /**
   * 같은 batch가 다시 와도(응답을 받기 전에 기기가 죽는 등) (기기, eventId)로 한 번만 저장한다.
   * 같은 요청 안에 같은 eventId가 두 번 있어도 하나만 남는다.
   */
  async recordPlayEvents(
    device: Device,
    events: PlayEventDto[],
  ): Promise<PlayEventsResultDto> {
    if (events.length === 0) {
      return { accepted: 0, duplicates: 0 };
    }
    const receivedAt = new Date();
    const inserted = await this.db
      .insert(playEvents)
      .values(
        events.map((event) => ({
          deviceId: device.id,
          eventId: event.eventId,
          sessionId: event.sessionId,
          submissionId: event.submissionId,
          revision: event.revision ?? null,
          startedAt: new Date(event.startedAt),
          durationMs: event.durationMs,
          completed: event.completed,
          receivedAt,
        })),
      )
      .onConflictDoNothing({
        target: [playEvents.deviceId, playEvents.eventId],
      })
      .returning({ eventId: playEvents.eventId });

    return {
      accepted: inserted.length,
      duplicates: events.length - inserted.length,
    };
  }
}
