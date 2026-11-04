import { Trace } from '@gsainfoteam/nest-observability';
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { AssetsService } from '../assets/assets.service.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { LineupsService } from '../lineups/lineups.service.js';
import {
  assets,
  categories,
  deviceTargetGroups,
  submissionTargetGroups,
  submissions,
  type Device,
} from '../db/schema.js';
import type { PlaylistDto, PlaylistItemDto } from './dto/playlist.dto.js';

/**
 * 편성 (요구사항 8절). 서버가 유효한 편성만 내려준다.
 * - 승인된 신청 (APPROVED·SCHEDULED·PUBLISHED). 배치가 상태를 늦게 바꿔도 기간으로 판정한다
 * - startAt <= 지금 < endAt
 * - 중단·취소·반려·검토 대기는 빠진다. 중단하면 다음 편성 요청부터 사라진다
 * - 이 기기가 대상: 신청에 대상 그룹이 없으면 전체, 있으면 기기 그룹과 하나라도 겹쳐야 한다
 * - 포스터 검증이 끝난 것(READY). 영상은 변환까지 끝난 것
 */
@Trace()
@Injectable()
export class PlaylistService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly assetsService: AssetsService,
    private readonly lineupsService: LineupsService,
  ) {}

  async forDevice(device: Device): Promise<PlaylistDto> {
    const now = new Date();
    // 화면 설정은 편성 그룹의 설정에 기기 예외를 덮은 값이다
    const settings = await this.lineupsService.effectiveSettingsOf(device);
    const targetsDevice = sql`(
      not exists (
        select 1 from ${submissionTargetGroups}
        where ${submissionTargetGroups.submissionId} = ${submissions.id}
      )
      or exists (
        select 1 from ${submissionTargetGroups}
        join ${deviceTargetGroups}
          on ${deviceTargetGroups.targetGroupId} = ${submissionTargetGroups.targetGroupId}
        where ${submissionTargetGroups.submissionId} = ${submissions.id}
          and ${deviceTargetGroups.deviceId} = ${device.id}
      )
    )`;

    const rows = await this.db
      .select({
        submissionId: submissions.id,
        revision: submissions.version,
        title: submissions.title,
        category: categories.name,
        // 포스터는 asset이 항상 있고, 아래 inner join이 READY인 것만 남긴다
        assetId: assets.id,
        detailUrl: submissions.detailUrl,
        startAt: submissions.startAt,
        endAt: submissions.endAt,
        priority: submissions.priority,
        checksum: assets.checksum,
        width: assets.width,
        height: assets.height,
        kind: assets.kind,
        durationMs: assets.durationMs,
        hasAudio: assets.hasAudio,
        subtitle: submissions.subtitle,
        location: submissions.location,
        organizerName: submissions.organizerName,
      })
      .from(submissions)
      .innerJoin(categories, eq(categories.id, submissions.categoryId))
      .innerJoin(
        assets,
        and(eq(assets.id, submissions.assetId), eq(assets.status, 'READY')),
      )
      .where(
        and(
          // 이 응답(v1)은 포스터만 안다. 다른 종류는 편성 응답 v2에 실린다
          eq(submissions.type, 'POSTER'),
          inArray(submissions.status, ['APPROVED', 'SCHEDULED', 'PUBLISHED']),
          lte(submissions.startAt, now),
          gt(submissions.endAt, now),
          targetsDevice,
        ),
      )
      .orderBy(
        desc(submissions.priority),
        asc(submissions.startAt),
        asc(submissions.id),
      );

    const items: PlaylistItemDto[] = rows.map((row) => ({
      submissionId: row.submissionId,
      revision: row.revision,
      title: row.title,
      category: row.category,
      kind: row.kind,
      width: row.width!,
      height: row.height!,
      durationMs: row.durationMs,
      assetUrl: this.assetsService.variantUrls(row.assetId).tv,
      video:
        row.kind === 'VIDEO'
          ? {
              url: this.assetsService.videoUrl({
                id: row.assetId,
                kind: row.kind,
              })!,
              hasAudio: row.hasAudio!,
            }
          : null,
      detailUrl: row.detailUrl,
      // 조회 조건이 기간 안의 것만 남기므로 기간이 있다
      startsAt: row.startAt!.toISOString(),
      endsAt: row.endAt!.toISOString(),
      priority: row.priority,
      checksum: row.checksum!,
      subtitle: row.subtitle,
      location: row.location,
      organizerName: row.organizerName,
    }));
    const layout = {
      type: settings.posterLayout,
      rotationSeconds: settings.rotationSeconds,
    };

    return {
      serverTime: now.toISOString(),
      playlistVersion: playlistVersionOf({
        items,
        deviceName: device.name,
        layout,
        refreshAfterSeconds: settings.refreshAfterSeconds,
      }),
      deviceName: device.name,
      refreshAfterSeconds: settings.refreshAfterSeconds,
      layout,
      items,
    };
  }
}

/**
 * 편성 내용의 해시. serverTime처럼 매번 바뀌는 값은 넣지 않는다.
 * 게시물이 기간에 들어오거나 나가도 items가 바뀌므로 버전이 바뀐다.
 * 기기 이름도 넣는다. 이름만 바꿔도 304가 아닌 새 편성을 받아 화면에 반영한다.
 */
export function playlistVersionOf(content: {
  items: PlaylistItemDto[];
  deviceName: string;
  layout: { type: string; rotationSeconds: number };
  refreshAfterSeconds: number;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, 16);
}
