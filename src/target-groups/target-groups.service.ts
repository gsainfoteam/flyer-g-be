import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { validationFailed } from '../common/errors/validation.js';
import { violatesForeignKey, violatesUnique } from '../db/errors.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { deviceTargetGroups, devices, targetGroups } from '../db/schema.js';
import type {
  CreateTargetGroupDto,
  UpdateTargetGroupDto,
} from './dto/target-group-input.dto.js';
import type { TargetGroupDto } from './dto/target-group.dto.js';

const NAME_UNIQUE_INDEX = 'target_groups_name_lower_uq';
// 그룹을 가리키는 FK. 둘 다 ON DELETE no action이라 쓰는 곳이 있으면 삭제가 실패한다.
const GROUP_REFERENCES = [
  'device_target_groups_target_group_id_target_groups_id_fk',
  'submission_target_groups_target_group_id_target_groups_id_fk',
];

@Injectable()
export class TargetGroupsService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 전체 그룹을 이름순으로 준다. 숨긴 그룹도 준다(과거 신청의 그룹 이름을 보여 줘야 한다).
   * 기기 수는 활성 기기만 센다.
   */
  findAll(): Promise<TargetGroupDto[]> {
    return this.summaries();
  }

  async findOne(id: string): Promise<TargetGroupDto> {
    const [group] = await this.summaries(eq(targetGroups.id, id));
    if (!group) {
      throw notFound();
    }
    return group;
  }

  async create(
    admin: AuthUser,
    dto: CreateTargetGroupDto,
  ): Promise<TargetGroupDto> {
    const now = new Date();
    const id = `grp_${randomBytes(8).toString('hex')}`;

    await this.withNameGuard(() =>
      this.db.transaction(async (tx) => {
        await tx.insert(targetGroups).values({
          id,
          name: dto.name,
          createdAt: now,
          updatedAt: now,
        });
        await this.auditService.record(tx, {
          actor: { type: 'USER', id: admin.id },
          action: 'GROUP_CREATED',
          target: { type: 'GROUP', id },
          metadata: { name: dto.name },
          at: now,
        });
      }),
    );

    return this.findOne(id);
  }

  /** 보낸 필드 중 실제로 바뀐 것만 반영한다. 바뀐 게 없으면 감사 로그도 남기지 않는다. */
  async update(
    admin: AuthUser,
    id: string,
    dto: UpdateTargetGroupDto,
  ): Promise<TargetGroupDto> {
    const now = new Date();

    await this.withNameGuard(() =>
      this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(targetGroups)
          .where(eq(targetGroups.id, id))
          .for('update');
        if (!current) {
          throw notFound();
        }

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (dto.name !== undefined && dto.name !== current.name) {
          changes.name = { from: current.name, to: dto.name };
        }
        const isHidden = !current.isActive;
        if (dto.isHidden !== undefined && dto.isHidden !== isHidden) {
          changes.isHidden = { from: isHidden, to: dto.isHidden };
        }
        if (Object.keys(changes).length === 0) {
          return;
        }

        await tx
          .update(targetGroups)
          .set({
            name: changes.name ? dto.name : undefined,
            isActive: changes.isHidden ? !dto.isHidden : undefined,
            updatedAt: now,
          })
          .where(eq(targetGroups.id, id));
        await this.auditService.record(tx, {
          actor: { type: 'USER', id: admin.id },
          action: 'GROUP_UPDATED',
          target: { type: 'GROUP', id },
          metadata: { changes },
          at: now,
        });
      }),
    );

    return this.findOne(id);
  }

  /**
   * 어떤 기기·신청도 쓰지 않는 그룹만 지운다(오타로 만든 그룹 정리용).
   * 쓰는 곳은 FK가 확인하므로 동시에 기기에 연결되는 경우에도 지워지지 않는다.
   */
  async remove(admin: AuthUser, id: string): Promise<void> {
    const now = new Date();
    try {
      await this.db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(targetGroups)
          .where(eq(targetGroups.id, id))
          .returning({ name: targetGroups.name });
        if (!deleted) {
          throw notFound();
        }
        await this.auditService.record(tx, {
          actor: { type: 'USER', id: admin.id },
          action: 'GROUP_DELETED',
          target: { type: 'GROUP', id },
          // 지운 뒤에는 targetTitle로 이름을 찾을 수 없어 남겨 둔다.
          metadata: { name: deleted.name },
          at: now,
        });
      });
    } catch (error) {
      if (GROUP_REFERENCES.some((fk) => violatesForeignKey(error, fk))) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'Target group is used by devices or submissions',
        );
      }
      throw error;
    }
  }

  /** 주어진 ID 중 없거나 숨긴 그룹 */
  async findUnavailable(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db
      .select({ id: targetGroups.id })
      .from(targetGroups)
      .where(
        and(inArray(targetGroups.id, ids), eq(targetGroups.isActive, true)),
      );
    const available = new Set(rows.map((row) => row.id));
    return ids.filter((id) => !available.has(id));
  }

  private summaries(where?: SQL): Promise<TargetGroupDto[]> {
    return this.db
      .select({
        id: targetGroups.id,
        name: targetGroups.name,
        deviceCount:
          sql`count(${devices.id}) filter (where ${devices.isActive})`.mapWith(
            Number,
          ),
        isHidden: sql<boolean>`not ${targetGroups.isActive}`,
      })
      .from(targetGroups)
      .leftJoin(
        deviceTargetGroups,
        eq(deviceTargetGroups.targetGroupId, targetGroups.id),
      )
      .leftJoin(devices, eq(devices.id, deviceTargetGroups.deviceId))
      .where(where)
      .groupBy(targetGroups.id)
      .orderBy(asc(targetGroups.name), asc(targetGroups.id));
  }

  /** 대소문자를 무시한 이름 중복은 DB unique 제약이 막는다. 그 위반을 422로 바꾼다. */
  private async withNameGuard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (violatesUnique(error, NAME_UNIQUE_INDEX)) {
        throw validationFailed({ name: '같은 이름의 그룹이 이미 있습니다.' });
      }
      throw error;
    }
  }
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Target group not found',
  );
}
