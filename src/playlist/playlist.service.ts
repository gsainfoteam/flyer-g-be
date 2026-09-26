import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { AssetsService } from '../assets/assets.service.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
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
 * - 포스터 검증이 끝난 것(READY)
 */
@Injectable()
export class PlaylistService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly assetsService: AssetsService,
  ) {}

  async forDevice(device: Device): Promise<PlaylistDto> {
    const now = new Date();
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
        assetId: submissions.assetId,
        detailUrl: submissions.detailUrl,
        startAt: submissions.startAt,
        endAt: submissions.endAt,
        priority: submissions.priority,
        checksum: assets.checksum,
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
      assetUrl: this.assetsService.variantUrls(row.assetId).tv,
      detailUrl: row.detailUrl,
      startsAt: row.startAt.toISOString(),
      endsAt: row.endAt.toISOString(),
      priority: row.priority,
      checksum: row.checksum!,
      subtitle: row.subtitle,
      location: row.location,
      organizerName: row.organizerName,
    }));
    const layout = {
      type: device.layout,
      rotationSeconds: device.rotationSeconds,
    };

    return {
      serverTime: now.toISOString(),
      playlistVersion: playlistVersionOf({
        items,
        layout,
        refreshAfterSeconds: device.refreshAfterSeconds,
      }),
      refreshAfterSeconds: device.refreshAfterSeconds,
      layout,
      items,
    };
  }
}

/**
 * 편성 내용의 해시. serverTime처럼 매번 바뀌는 값은 넣지 않는다.
 * 게시물이 기간에 들어오거나 나가도 items가 바뀌므로 버전이 바뀐다.
 */
export function playlistVersionOf(content: {
  items: PlaylistItemDto[];
  layout: { type: string; rotationSeconds: number };
  refreshAfterSeconds: number;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, 16);
}
