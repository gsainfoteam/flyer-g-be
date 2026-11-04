import { Trace } from '@gsainfoteam/nest-observability';
import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import {
  AppException,
  type FieldErrors,
} from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { validationFailed } from '../common/errors/validation.js';
import { DB_CONNECTION, type Database, type Transaction } from '../db/index.js';
import {
  groupLineups,
  lineupBlocks,
  programs,
  users,
  type Device,
  type LineupBlock,
} from '../db/schema.js';
import { infoBarItemOf } from '../programs/program-types.js';
import type { LineupDto } from './dto/lineup.dto.js';
import {
  DEFAULT_LINEUP_SETTINGS,
  DEFAULT_PER_VISIT,
  type BlockInput,
  type DeviceOverrides,
  type LineupInput,
  type LineupSettings,
} from './lineup-schema.js';
import {
  pruneOverrides,
  resolveSettings,
  type LineupBlockView,
} from './resolve-lineup.js';

/** 편성이 가리키는 운영 컨텐츠 하나. path는 오류를 붙일 입력 위치다. */
type ProgramReference = {
  path: string;
  programId: string;
  /** 정보줄 칸이면 그 item. 운영 컨텐츠 종류가 이 칸에 맞아야 한다 */
  infoBarItem?: string;
};

/**
 * 그룹 편성 (FE 요청 2-2). 그룹마다 편성이 하나 있고, 기기는 편성 그룹(programGroupId)을 따른다.
 * 운영 컨텐츠 참조는 programs 행을 FOR KEY SHARE로 읽어 확인한다.
 * 운영 컨텐츠 삭제(⑩)는 행을 FOR UPDATE로 잡으므로 확인과 삭제가 엇갈리지 않는다.
 */
@Trace()
@Injectable()
export class LineupsService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
  ) {}

  async get(groupId: string): Promise<LineupDto> {
    const [row] = await this.db
      .select({
        lineup: groupLineups,
        editor: { id: users.id, name: users.name },
      })
      .from(groupLineups)
      .leftJoin(users, eq(users.id, groupLineups.updatedBy))
      .where(eq(groupLineups.groupId, groupId));
    if (!row) {
      throw notFound();
    }
    const blocks = await this.blocksOf(this.db, [groupId]);
    return {
      groupId,
      version: row.lineup.version,
      settings: row.lineup.settings,
      blocks: blocks.get(groupId) ?? [],
      updatedAt: row.lineup.updatedAt.toISOString(),
      updatedBy: row.editor,
    };
  }

  /** 편성 전체를 바꾼다. id가 없는 블록은 새로 만들고, 보내지 않은 블록은 지운다. */
  async replace(
    admin: AuthUser,
    groupId: string,
    input: LineupInput,
  ): Promise<LineupDto> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ version: groupLineups.version })
        .from(groupLineups)
        .where(eq(groupLineups.groupId, groupId))
        .for('update');
      if (!current) {
        throw notFound();
      }
      if (current.version !== input.version) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'Lineup has been changed',
        );
      }

      const existing = await this.blockIdsOf(tx, groupId);
      const fields: FieldErrors = {
        ...blockIdErrors(input.blocks, existing),
        ...(await this.checkPrograms(tx, [
          ...input.blocks.flatMap((block, index) =>
            block.source === 'PROGRAM'
              ? [
                  {
                    path: `blocks.${index}.programId`,
                    programId: block.programId,
                  },
                ]
              : [],
          ),
          ...infoBarReferences(input.settings, 'settings'),
        ])),
      };
      if (Object.keys(fields).length > 0) {
        throw validationFailed(fields);
      }

      await tx.delete(lineupBlocks).where(eq(lineupBlocks.groupId, groupId));
      if (input.blocks.length > 0) {
        await tx
          .insert(lineupBlocks)
          .values(
            input.blocks.map((block, index) => blockRow(groupId, index, block)),
          );
      }
      const version = current.version + 1;
      await tx
        .update(groupLineups)
        .set({
          version,
          settings: input.settings,
          updatedBy: admin.id,
          updatedAt: now,
        })
        .where(eq(groupLineups.groupId, groupId));
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'LINEUP_UPDATED',
        target: { type: 'GROUP', id: groupId },
        metadata: { version, blockCount: input.blocks.length },
        at: now,
      });
    });
    return this.get(groupId);
  }

  /** 그룹마다 편성 설정. 기기 응답과 편성 v1이 실제 설정을 계산할 때 쓴다. */
  async settingsOf(groupIds: string[]): Promise<Map<string, LineupSettings>> {
    const ids = [...new Set(groupIds)];
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({
        groupId: groupLineups.groupId,
        settings: groupLineups.settings,
      })
      .from(groupLineups)
      .where(inArray(groupLineups.groupId, ids));
    return new Map(rows.map((row) => [row.groupId, row.settings]));
  }

  /** 기기가 실제로 따르는 설정: 편성 그룹 설정 위에 기기 예외를 덮는다. */
  async effectiveSettingsOf(device: Device): Promise<LineupSettings> {
    const settings = await this.settingsOf([device.programGroupId]);
    return effectiveSettings(device, settings);
  }

  /**
   * 기기 예외를 저장하기 전에 부른다. 정보줄이 가리키는 운영 컨텐츠를 확인하고(422),
   * 편성 그룹에 없는 블록 id를 지운 값을 준다. 기기 저장과 같은 트랜잭션에서 부른다.
   */
  async prepareOverrides(
    tx: Transaction,
    groupId: string,
    overrides: DeviceOverrides,
  ): Promise<DeviceOverrides> {
    const fields = await this.checkPrograms(
      tx,
      infoBarReferences(overrides.settings, 'overrides.settings'),
    );
    if (Object.keys(fields).length > 0) {
      throw validationFailed(fields);
    }
    return pruneOverrides(overrides, await this.blockIdsOf(tx, groupId));
  }

  private async checkPrograms(
    tx: Transaction,
    references: ProgramReference[],
  ): Promise<FieldErrors> {
    if (references.length === 0) {
      return {};
    }
    const rows = await tx
      .select({ id: programs.id, type: programs.type })
      .from(programs)
      .where(
        inArray(programs.id, [
          ...new Set(references.map((ref) => ref.programId)),
        ]),
      )
      .for('key share');
    const typeOf = new Map(rows.map((row) => [row.id, row.type]));

    const fields: FieldErrors = {};
    for (const ref of references) {
      const type = typeOf.get(ref.programId);
      if (type === undefined) {
        fields[ref.path] = '없는 운영 컨텐츠입니다.';
      } else if (
        ref.infoBarItem !== undefined &&
        infoBarItemOf(type) !== ref.infoBarItem
      ) {
        fields[ref.path] =
          `이 운영 컨텐츠는 정보줄의 ${ref.infoBarItem} 칸에 쓸 수 없습니다.`;
      }
    }
    return fields;
  }

  private async blockIdsOf(
    tx: Transaction,
    groupId: string,
  ): Promise<Set<string>> {
    const rows = await tx
      .select({ id: lineupBlocks.id })
      .from(lineupBlocks)
      .where(eq(lineupBlocks.groupId, groupId));
    return new Set(rows.map((row) => row.id));
  }

  private async blocksOf(
    db: Database | Transaction,
    groupIds: string[],
  ): Promise<Map<string, LineupBlockView[]>> {
    const rows = await db
      .select()
      .from(lineupBlocks)
      .where(inArray(lineupBlocks.groupId, groupIds))
      .orderBy(asc(lineupBlocks.groupId), asc(lineupBlocks.position));
    const result = new Map<string, LineupBlockView[]>();
    for (const row of rows) {
      result.set(row.groupId, [
        ...(result.get(row.groupId) ?? []),
        toView(row),
      ]);
    }
    return result;
  }
}

/**
 * 그룹을 만들 때 같은 트랜잭션에서 기본 편성을 만든다(FE 7-11): 기본 설정과 포스터 블록 하나.
 * 지금 TV 동작과 같다.
 */
export async function createDefaultLineup(
  tx: Transaction,
  groupId: string,
  now: Date,
): Promise<void> {
  await tx.insert(groupLineups).values({
    groupId,
    settings: DEFAULT_LINEUP_SETTINGS,
    updatedAt: now,
  });
  await tx.insert(lineupBlocks).values(
    blockRow(groupId, 0, {
      source: 'SUBMISSIONS',
      submissionType: 'POSTER',
      durationSeconds: 60,
      schedule: { type: 'ALWAYS' },
      enabled: true,
    }),
  );
}

/**
 * settingsOf로 읽은 설정에서 기기의 실제 설정을 만든다.
 * 그룹마다 편성이 반드시 있지만(그룹과 같이 생긴다), 없으면 기본값을 쓴다.
 */
export function effectiveSettings(
  device: Pick<Device, 'programGroupId' | 'lineupOverrides'>,
  settingsByGroup: ReadonlyMap<string, LineupSettings>,
): LineupSettings {
  return resolveSettings(
    settingsByGroup.get(device.programGroupId) ?? DEFAULT_LINEUP_SETTINGS,
    device.lineupOverrides,
  );
}

function newBlockId(): string {
  return `blk_${randomBytes(6).toString('hex')}`;
}

function blockRow(
  groupId: string,
  position: number,
  block: BlockInput,
): typeof lineupBlocks.$inferInsert {
  const common = {
    groupId,
    id: block.id ?? newBlockId(),
    position,
    durationSeconds: block.durationSeconds,
    schedule: block.schedule,
    enabled: block.enabled,
  };
  return block.source === 'SUBMISSIONS'
    ? {
        ...common,
        source: 'SUBMISSIONS',
        submissionType: block.submissionType,
        perVisit: block.perVisit ?? DEFAULT_PER_VISIT[block.submissionType],
      }
    : { ...common, source: 'PROGRAM', programId: block.programId };
}

function toView(row: LineupBlock): LineupBlockView {
  return {
    id: row.id,
    source: row.source,
    submissionType: row.submissionType,
    programId: row.programId,
    durationSeconds: row.durationSeconds,
    perVisit: row.perVisit,
    schedule: row.schedule,
    enabled: row.enabled,
  };
}

/** 보낸 블록 id는 이 그룹에 있는 것이어야 하고 한 번만 나와야 한다. */
function blockIdErrors(
  blocks: BlockInput[],
  existing: ReadonlySet<string>,
): FieldErrors {
  const fields: FieldErrors = {};
  const seen = new Set<string>();
  blocks.forEach((block, index) => {
    if (block.id === undefined) {
      return;
    }
    if (!existing.has(block.id)) {
      fields[`blocks.${index}.id`] =
        '이 그룹에 없는 블록입니다. 새 블록은 id 없이 보내세요.';
    } else if (seen.has(block.id)) {
      fields[`blocks.${index}.id`] = '같은 블록을 두 번 넣을 수 없습니다.';
    }
    seen.add(block.id);
  });
  return fields;
}

function infoBarReferences(
  settings: Partial<LineupSettings>,
  prefix: string,
): ProgramReference[] {
  return (settings.infoBar ?? []).map((entry, index) => ({
    path: `${prefix}.infoBar.${index}.programId`,
    programId: entry.programId,
    infoBarItem: entry.item,
  }));
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Target group not found',
  );
}
