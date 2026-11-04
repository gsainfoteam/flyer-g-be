import { Trace } from '@gsainfoteam/nest-observability';
import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { AssetsService } from '../assets/assets.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import {
  assets,
  categories,
  deviceTargetGroups,
  devices,
  programs,
  submissionTargetGroups,
  submissions,
  submissionTypeEnum,
  type Device,
  type SubmissionType,
} from '../db/schema.js';
import { LineupsService } from '../lineups/lineups.service.js';
import { kindOf } from '../submissions/kinds/index.js';
import { posterPlaylistItem } from '../submissions/kinds/poster.kind.js';
import type {
  PlaylistRow,
  PlaylistSubmissionItem,
} from '../submissions/kinds/submission-kind.js';
import type {
  PlaylistProgramDto,
  PlaylistSubmissionsDto,
  PlaylistV2Dto,
} from './dto/playlist-v2.dto.js';
import type { PlaylistDto, PlaylistItemDto } from './dto/playlist.dto.js';

/** 승인된 신청. 배치가 상태를 늦게 바꿔도 기간으로 판정한다 */
const PUBLISHABLE_STATUSES = ['APPROVED', 'SCHEDULED', 'PUBLISHED'] as const;

/**
 * 이 기기 대상: 신청에 대상 그룹이 없으면 전체, 있으면 기기 그룹과 하나라도 겹쳐야 한다.
 * Keep this query builder factory outside the traced service class.
 */
function targetsDevice(deviceId: string) {
  return sql`(
    not exists (
      select 1 from ${submissionTargetGroups}
      where ${submissionTargetGroups.submissionId} = ${submissions.id}
    )
    or exists (
      select 1 from ${submissionTargetGroups}
      join ${deviceTargetGroups}
        on ${deviceTargetGroups.targetGroupId} = ${submissionTargetGroups.targetGroupId}
      where ${submissionTargetGroups.submissionId} = ${submissions.id}
        and ${deviceTargetGroups.deviceId} = ${deviceId}
    )
  )`;
}

/**
 * 편성 (요구사항 8절). 서버가 유효한 편성만 내려준다.
 * - 승인된 신청 (APPROVED·SCHEDULED·PUBLISHED), startAt <= 지금 < endAt
 * - 중단·취소·반려·검토 대기는 빠진다. 중단하면 다음 편성 요청부터 사라진다
 * - 이 기기가 대상인 것 (targetsDevice)
 * - 미디어가 있으면 검증이 끝난 것(READY). 영상은 변환까지 끝난 것
 *
 * v1은 포스터만, v2는 모든 종류와 그룹 편성을 싣는다. 화면 설정은 편성 그룹의 설정에 기기 예외를 덮은 값이다.
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
    const [settings, rows] = await Promise.all([
      this.lineupsService.effectiveSettingsOf(device),
      this.liveSubmissions(device.id, now, ['POSTER']),
    ]);

    const items = rows.map((row) =>
      posterPlaylistItem(row, this.assetsService),
    );
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

  /** 편성 응답 v2. TV(`?v=2`)와 운영자 미리보기가 같은 결과를 받는다 */
  async forDeviceV2(device: Device): Promise<PlaylistV2Dto> {
    const now = new Date();
    const [lineup, rows] = await Promise.all([
      this.lineupsService.effectiveLineupOf(device),
      this.liveSubmissions(device.id, now),
    ]);
    const blocks = lineup.blocks.filter((block) => block.enabled);
    const programIds = [
      ...blocks.flatMap((block) => (block.programId ? [block.programId] : [])),
      ...lineup.settings.infoBar.map((entry) => entry.programId),
    ];

    const [submissionItems, programItems] = await Promise.all([
      this.submissionItems(rows),
      this.programsOf(programIds),
    ]);
    const content = {
      timezone: 'Asia/Seoul' as const,
      deviceName: device.name,
      refreshAfterSeconds: lineup.settings.refreshAfterSeconds,
      settings: lineup.settings,
      blocks,
      submissions: submissionItems,
      programs: programItems,
      live: null,
    };
    return {
      serverTime: now.toISOString(),
      ...content,
      playlistVersion: versionOf(content),
    };
  }

  /**
   * 운영자가 기기의 v2 편성을 미리 본다(FE 7-4).
   * 읽기만 하므로 lastSeenAt·heartbeat·온라인 판정을 건드리지 않는다. 비활성 기기도 볼 수 있다.
   */
  async preview(deviceId: string): Promise<PlaylistV2Dto> {
    const [device] = await this.db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId));
    if (!device) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Device not found',
      );
    }
    return this.forDeviceV2(device);
  }

  /** 지금 이 기기에 게시 중인 신청. 우선순위 높은 순, 같으면 시작이 이른 순 */
  private async liveSubmissions(
    deviceId: string,
    now: Date,
    types?: SubmissionType[],
  ): Promise<PlaylistRow[]> {
    const rows = await this.db
      .select({
        id: submissions.id,
        type: submissions.type,
        version: submissions.version,
        title: submissions.title,
        detailUrl: submissions.detailUrl,
        priority: submissions.priority,
        subtitle: submissions.subtitle,
        location: submissions.location,
        organizerName: submissions.organizerName,
        startAt: submissions.startAt,
        endAt: submissions.endAt,
        categoryName: categories.name,
        asset: {
          id: assets.id,
          kind: assets.kind,
          width: assets.width,
          height: assets.height,
          durationMs: assets.durationMs,
          hasAudio: assets.hasAudio,
          checksum: assets.checksum,
        },
      })
      .from(submissions)
      .leftJoin(categories, eq(categories.id, submissions.categoryId))
      .leftJoin(assets, eq(assets.id, submissions.assetId))
      .where(
        and(
          types ? inArray(submissions.type, types) : undefined,
          inArray(submissions.status, PUBLISHABLE_STATUSES),
          lte(submissions.startAt, now),
          gt(submissions.endAt, now),
          or(isNull(submissions.assetId), eq(assets.status, 'READY')),
          targetsDevice(deviceId),
        ),
      )
      .orderBy(
        desc(submissions.priority),
        asc(submissions.startAt),
        asc(submissions.id),
      );
    // 조회 조건이 기간 안의 것만 남기므로 기간이 있다
    return rows.map((row) => ({
      ...row,
      startAt: row.startAt!,
      endAt: row.endAt!,
    }));
  }

  /** 종류마다 상세를 한 번에 읽고 종류의 정의로 항목을 만든다 */
  private async submissionItems(
    rows: PlaylistRow[],
  ): Promise<PlaylistSubmissionsDto> {
    const items = Object.fromEntries(
      submissionTypeEnum.enumValues.map((type) => [type, []]),
    ) as unknown as Record<SubmissionType, PlaylistSubmissionItem[]>;

    for (const type of submissionTypeEnum.enumValues) {
      const ofType = rows.filter((row) => row.type === type);
      if (ofType.length === 0) {
        continue;
      }
      const kind = kindOf(type);
      const details = kind.details
        ? await kind.details.load(
            this.db,
            ofType.map((row) => row.id),
          )
        : null;
      items[type] = ofType.map((row) =>
        kind.toPlaylistItem(
          row,
          details?.get(row.id) ?? null,
          this.assetsService,
        ),
      );
    }
    // 종류 정의가 종류에 맞는 모양을 만든다(submissions/kinds/*.kind.ts)
    return items as unknown as PlaylistSubmissionsDto;
  }

  private async programsOf(
    ids: string[],
  ): Promise<Record<string, PlaylistProgramDto>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return {};
    }
    const rows = await this.db
      .select()
      .from(programs)
      .where(inArray(programs.id, unique))
      .orderBy(asc(programs.id));
    return Object.fromEntries(
      rows.map((row) => [
        row.id,
        // data는 운영 컨텐츠 종류(⑩)가 만든다
        { type: row.type, name: row.name, params: row.params, data: null },
      ]),
    );
  }
}

/** 내용의 해시. serverTime처럼 매번 바뀌는 값은 넣지 않는다 */
function versionOf(content: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, 16);
}

/**
 * 편성 v1 내용의 해시.
 * 게시물이 기간에 들어오거나 나가도 items가 바뀌므로 버전이 바뀐다.
 * 기기 이름도 넣는다. 이름만 바꿔도 304가 아닌 새 편성을 받아 화면에 반영한다.
 */
export function playlistVersionOf(content: {
  items: PlaylistItemDto[];
  deviceName: string;
  layout: { type: string; rotationSeconds: number };
  refreshAfterSeconds: number;
}): string {
  return versionOf(content);
}
