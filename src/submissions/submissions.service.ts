import { Trace } from '@gsainfoteam/nest-observability';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { AssetsService } from '../assets/assets.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { isReviewer } from '../auth/types/role.js';
import { CategoriesService } from '../categories/categories.service.js';
import {
  AppException,
  type FieldErrors,
} from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { validationFailed } from '../common/errors/validation.js';
import { decodeCursor } from '../common/pagination/cursor.js';
import { toPage, type Page } from '../common/pagination/page.js';
import { seoulDate, startOfSeoulDay } from '../common/time/seoul-time.js';
import { violatesUnique } from '../db/errors.js';
import { DB_CONNECTION, type Database, type Transaction } from '../db/index.js';
import {
  assets,
  categories,
  reviews,
  submissionStatusEnum,
  submissionTargetGroups,
  submissionTypeEnum,
  submissions,
  users,
  type Asset,
  type ReviewDecision,
  type Submission,
  type SubmissionStatus,
  type SubmissionType,
} from '../db/schema.js';
import { TargetGroupsService } from '../target-groups/target-groups.service.js';
import type {
  CreateSubmissionDto,
  UpdateSubmissionDto,
} from './dto/submission-input.dto.js';
import type {
  ListSubmissionsQueryDto,
  ReviewQueueQueryDto,
  SubmissionScope,
} from './dto/submission-query.dto.js';
import type {
  SubmissionAuthorDto,
  SubmissionDetailDto,
  SubmissionDto,
  SubmissionSummaryDto,
  SubmissionTypeSummaryDto,
} from './dto/submission.dto.js';
import {
  KIND_INPUT_FIELDS,
  kindOf,
  type SubmissionKind,
} from './kinds/index.js';
import type {
  KindColumns,
  KindContext,
  KindInput,
} from './kinds/submission-kind.js';
import {
  canCancel,
  EDITABLE_STATUSES,
  hasStartedPublishing,
  REAPPROVAL_STATUSES,
  RETURNED_STATUSES,
  SUBMITTABLE_STATUSES,
} from './submission-rules.js';

export type SubmissionRow = Submission & {
  categoryName: string | null;
  requesterName: string;
  /** 주 미디어(submissions.asset_id)의 정보. 없으면 null */
  assetKind: Asset['kind'] | null;
  assetWidth: number | null;
  assetHeight: number | null;
  assetDurationMs: number | null;
  lastDecision: ReviewDecision | null;
};

const ACTIVE_NOTICE_INDEX = 'submissions_ziggle_notice_id_active_uq';

// Postgres advisory lock 번호. 마이그레이션(src/db/index.ts)·주기 작업(src/jobs/job-lock.ts) 잠금과 겹치지 않는 값이다.
const DAILY_LIMIT_LOCK_NAMESPACE = 1179207271;

const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

/** 검토 대기열 정렬 기준. 모든 신청은 만들 때 submittedAt이 채워지지만 안전하게 createdAt으로 보완한다. */
const waitingSince = sql<Date>`coalesce(${submissions.submittedAt}, ${submissions.createdAt})`;

/** 가장 최근 검토 결정. 검토 대기 목록에서 처음 낸 신청과 다시 낸 신청을 가르는 데 쓴다. */
const lastDecision = sql<ReviewDecision | null>`(
  select ${reviews.decision} from ${reviews}
  where ${reviews.submissionId} = ${submissions.id}
  order by ${reviews.reviewedAt} desc, ${reviews.id} desc
  limit 1
)`;

/**
 * Keep this query builder factory outside the traced service class. Drizzle
 * query builders are thenable, so @Trace would otherwise execute this query
 * and replace the builder with its rows before callers can add orderBy/limit.
 */
function selectSubmissionRows(db: Database, where: SQL | undefined) {
  return db
    .select({
      id: submissions.id,
      type: submissions.type,
      requesterId: submissions.requesterId,
      ziggleNoticeId: submissions.ziggleNoticeId,
      title: submissions.title,
      categoryId: submissions.categoryId,
      assetId: submissions.assetId,
      detailUrl: submissions.detailUrl,
      startAt: submissions.startAt,
      endAt: submissions.endAt,
      status: submissions.status,
      priority: submissions.priority,
      organizerName: submissions.organizerName,
      subtitle: submissions.subtitle,
      location: submissions.location,
      description: submissions.description,
      version: submissions.version,
      submittedAt: submissions.submittedAt,
      createdAt: submissions.createdAt,
      updatedAt: submissions.updatedAt,
      categoryName: categories.name,
      requesterName: users.name,
      assetKind: assets.kind,
      assetWidth: assets.width,
      assetHeight: assets.height,
      assetDurationMs: assets.durationMs,
      lastDecision,
    })
    .from(submissions)
    .leftJoin(categories, eq(categories.id, submissions.categoryId))
    .innerJoin(users, eq(users.id, submissions.requesterId))
    .leftJoin(assets, eq(assets.id, submissions.assetId))
    .where(where)
    .$dynamic();
}

@Trace()
@Injectable()
export class SubmissionsService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly assetsService: AssetsService,
    private readonly categoriesService: CategoriesService,
    private readonly targetGroupsService: TargetGroupsService,
    private readonly auditService: AuditService,
  ) {}

  /** 생성과 제출을 한 번에 한다. 만들어지면 바로 검토 대기다. */
  async create(
    user: AuthUser,
    dto: CreateSubmissionDto,
  ): Promise<SubmissionDetailDto> {
    const now = new Date();
    const kind = kindOf(dto.type ?? 'POSTER');
    // 기간을 받지 않는 종류는 승인 때 정한다. 보냈으면 unacceptedFields가 거절한다
    const period =
      kind.schedule.mode === 'REQUESTED'
        ? { startAt: new Date(dto.startAt!), endAt: new Date(dto.endAt!) }
        : { startAt: null, endAt: null };
    const targetGroupIds = kind.targetable ? (dto.targetGroupIds ?? []) : [];

    const resolved = await kind.resolve(
      kindInputOf(dto),
      null,
      this.kindContext(user),
    );
    const errors: FieldErrors = {
      ...unacceptedFields(kind, dto),
      ...validateSchedule(kind, period, now),
      ...resolved.errors,
      ...(await this.validateTargetGroups(targetGroupIds)),
    };
    if (Object.keys(errors).length > 0) {
      throw validationFailed(errors);
    }

    const id = await this.withNoticeGuard(() =>
      this.db.transaction(async (tx) => {
        await this.assertDailyLimit(tx, user, kind, now);
        const [row] = await tx
          .insert(submissions)
          .values({
            type: kind.type,
            requesterId: user.id,
            ...resolved.columns,
            ...period,
            status: 'PENDING_REVIEW',
            submittedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: submissions.id });
        await kind.details?.save(tx, row.id, resolved.detail);
        if (targetGroupIds.length > 0) {
          await tx.insert(submissionTargetGroups).values(
            targetGroupIds.map((targetGroupId) => ({
              submissionId: row.id,
              targetGroupId,
            })),
          );
        }
        await this.auditService.record(tx, {
          actor: { type: 'USER', id: user.id },
          action: 'SUBMISSION_CREATED',
          target: { type: 'SUBMISSION', id: row.id },
          at: now,
        });
        return row.id;
      }),
    );

    return this.detail(id, now, user);
  }

  async list(
    user: AuthUser,
    query: ListSubmissionsQueryDto,
  ): Promise<Page<SubmissionDto>> {
    this.assertScope(user, query.scope);
    const now = new Date();

    const filter = and(
      this.scopeCondition(user, query.scope),
      query.statuses?.length
        ? inArray(submissions.status, query.statuses)
        : ne(submissions.status, 'ARCHIVED'),
      typeCondition(query.type),
    );

    // 최신 신청부터. createdAt이 같으면 id로 순서를 고정한다.
    let pageFilter = filter;
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, cursorSchema);
      pageFilter = and(
        filter,
        sql`(${submissions.createdAt}, ${submissions.id}) < (${createdAt}::timestamptz, ${id}::uuid)`,
      );
    }

    const [rows, [{ total }]] = await Promise.all([
      selectSubmissionRows(this.db, pageFilter)
        .orderBy(desc(submissions.createdAt), desc(submissions.id))
        .limit(query.limit + 1),
      this.db.select({ total: count() }).from(submissions).where(filter),
    ]);
    const [groupIds, details] = await Promise.all([
      this.targetGroupIdsOf(rows.map((row) => row.id)),
      this.detailsOf(rows),
    ]);

    return toPage(rows, {
      limit: query.limit,
      totalCount: total,
      serverTime: now,
      cursorOf: (row) => [row.createdAt.toISOString(), row.id],
      map: (row) =>
        this.toDto(user, row, groupIds.get(row.id) ?? [], details.get(row.id)),
    });
  }

  async summary(
    user: AuthUser,
    scope: SubmissionScope,
  ): Promise<SubmissionSummaryDto> {
    this.assertScope(user, scope);
    const now = new Date().toISOString();
    const filter = this.scopeCondition(user, scope);
    const { status, startAt, endAt } = submissions;
    const approved = sql`${status} in ('APPROVED', 'SCHEDULED', 'PUBLISHED')`;

    const [byStatusRows, [effective], byTypeRows] = await Promise.all([
      this.db
        .select({ status, total: count() })
        .from(submissions)
        .where(filter)
        .groupBy(status),
      // 배치가 상태를 늦게 바꿔도 맞도록 승인 건은 기간으로 판정한다.
      this.db
        .select({
          published:
            sql`count(*) filter (where ${approved} and ${startAt} <= ${now}::timestamptz and ${endAt} > ${now}::timestamptz)`.mapWith(
              Number,
            ),
          scheduled:
            sql`count(*) filter (where ${status} in ('APPROVED', 'SCHEDULED') and ${startAt} > ${now}::timestamptz)`.mapWith(
              Number,
            ),
          ended:
            sql`count(*) filter (where ${status} = 'ENDED' or (${approved} and ${endAt} <= ${now}::timestamptz))`.mapWith(
              Number,
            ),
        })
        .from(submissions)
        .where(filter),
      this.db
        .select({
          type: submissions.type,
          pendingReview: count(),
          oldestSubmittedAt: sql<Date>`min(${waitingSince})`.mapWith(
            submissions.submittedAt,
          ),
        })
        .from(submissions)
        .where(and(filter, eq(status, 'PENDING_REVIEW')))
        .groupBy(submissions.type),
    ]);

    const byType = Object.fromEntries(
      submissionTypeEnum.enumValues.map((type) => [
        type,
        { pendingReview: 0, oldestSubmittedAt: null },
      ]),
    ) as Record<SubmissionType, SubmissionTypeSummaryDto>;
    for (const row of byTypeRows) {
      byType[row.type] = {
        pendingReview: row.pendingReview,
        oldestSubmittedAt: row.oldestSubmittedAt.toISOString(),
      };
    }

    const byStatus = Object.fromEntries(
      submissionStatusEnum.enumValues.map((value) => [value, 0]),
    ) as Record<SubmissionStatus, number>;
    for (const row of byStatusRows) {
      byStatus[row.status] = row.total;
    }

    return {
      calculatedAt: now,
      total:
        Object.values(byStatus).reduce((a, b) => a + b, 0) - byStatus.ARCHIVED,
      published: effective.published,
      scheduled: effective.scheduled,
      pendingReview: byStatus.PENDING_REVIEW,
      ended: effective.ended,
      byStatus,
      byType,
    };
  }

  /** 신청자 본인이나 검토자만 본다. 그 외에는 존재 여부도 알리지 않는다(404). */
  async findOne(user: AuthUser, id: string): Promise<SubmissionDetailDto> {
    const row = await this.findRow(id);
    if (!row || (row.requesterId !== user.id && !isReviewer(user.roles))) {
      throw notFound();
    }
    return this.detail(id, new Date(), user);
  }

  /**
   * 신청자 본인만 고친다. 승인된 내용을 고치면 검토 대기로 돌아간다.
   * 값이 실제로 바뀐 필드만 반영하므로, 폼 전체를 같은 값으로 다시 보내도 재승인은 생기지 않는다.
   */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdateSubmissionDto,
  ): Promise<SubmissionDetailDto> {
    const now = new Date();
    const current = await this.findOwnRow(user, id, dto.version);
    if (
      !EDITABLE_STATUSES.includes(current.status) ||
      hasStartedPublishing(current.status, current.startAt, now)
    ) {
      throw conflict(`Submission in ${current.status} cannot be edited`);
    }
    const kind = kindOf(current.type);
    if (!kind.resubmittable && RETURNED_STATUSES.includes(current.status)) {
      throw notResubmittable();
    }

    const currentDetail = (await this.detailsOf([current])).get(id) ?? null;
    const resolved = await kind.resolve(
      kindInputOf(dto),
      { columns: kindColumnsOf(current), detail: currentDetail },
      this.kindContext(user),
    );
    const errors: FieldErrors = {
      ...unacceptedFields(kind, dto),
      ...resolved.errors,
    };

    const changes: Partial<typeof submissions.$inferInsert> = {};
    const next: Partial<Submission> = {
      ...resolved.columns,
      startAt: dto.startAt ? new Date(dto.startAt) : undefined,
      endAt: dto.endAt ? new Date(dto.endAt) : undefined,
    };
    for (const [key, value] of Object.entries(next)) {
      const field = key as keyof Submission;
      if (value !== undefined && !sameValue(value, current[field])) {
        (changes as Record<string, unknown>)[field] = value;
      }
    }
    const detailChanged =
      kind.details !== null &&
      !kind.details.equals(currentDetail, resolved.detail);

    const currentGroups = (await this.targetGroupIdsOf([id])).get(id) ?? [];
    const groupsChanged =
      dto.targetGroupIds !== undefined &&
      !sameSet(dto.targetGroupIds, currentGroups);

    if (Object.keys(changes).length === 0 && !detailChanged && !groupsChanged) {
      if (Object.keys(errors).length > 0) {
        throw validationFailed(errors);
      }
      return this.detail(id, now, user);
    }

    const needsReapproval = REAPPROVAL_STATUSES.includes(current.status);
    const nextStatus = needsReapproval ? 'PENDING_REVIEW' : current.status;
    if (changes.startAt || changes.endAt || needsReapproval) {
      Object.assign(
        errors,
        validateSchedule(
          kind,
          {
            startAt: changes.startAt ?? current.startAt,
            endAt: changes.endAt ?? current.endAt,
          },
          now,
        ),
      );
    }
    if (groupsChanged) {
      // 이미 연결된 숨긴 그룹은 그대로 둘 수 있다. 새로 추가하는 그룹만 확인한다.
      Object.assign(
        errors,
        await this.validateTargetGroups(
          dto.targetGroupIds!.filter((id) => !currentGroups.includes(id)),
        ),
      );
    }
    if (Object.keys(errors).length > 0) {
      throw validationFailed(errors);
    }

    await this.withNoticeGuard(() =>
      this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(submissions)
          .set({
            ...changes,
            status: nextStatus,
            submittedAt: needsReapproval ? now : current.submittedAt,
            version: current.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(submissions.id, id),
              eq(submissions.version, current.version),
            ),
          )
          .returning({ id: submissions.id });
        if (!updated) {
          throw conflict('Submission was modified');
        }
        if (detailChanged) {
          await kind.details!.save(tx, id, resolved.detail);
        }
        if (groupsChanged) {
          await tx
            .delete(submissionTargetGroups)
            .where(eq(submissionTargetGroups.submissionId, id));
          if (dto.targetGroupIds!.length > 0) {
            await tx.insert(submissionTargetGroups).values(
              dto.targetGroupIds!.map((targetGroupId) => ({
                submissionId: id,
                targetGroupId,
              })),
            );
          }
        }
        await this.auditService.record(tx, {
          actor: { type: 'USER', id: user.id },
          action: 'SUBMISSION_UPDATED',
          target: { type: 'SUBMISSION', id },
          metadata: {
            changedFields: [
              ...Object.keys(changes),
              ...(detailChanged ? kind.inputFields : []),
              ...(groupsChanged ? ['targetGroupIds'] : []),
            ],
            fromStatus: current.status,
            toStatus: nextStatus,
          },
          at: now,
        });
      }),
    );

    return this.detail(id, now, user);
  }

  /** 반려·중단된 신청을 고친 뒤 다시 검토를 요청한다. */
  async submit(
    user: AuthUser,
    id: string,
    version: number,
  ): Promise<SubmissionDetailDto> {
    const now = new Date();
    const current = await this.findOwnRow(user, id, version);
    if (!SUBMITTABLE_STATUSES.includes(current.status)) {
      throw conflict(`Submission in ${current.status} cannot be submitted`);
    }
    const kind = kindOf(current.type);
    if (!kind.resubmittable) {
      throw notResubmittable();
    }
    const errors = validateSchedule(kind, current, now);
    if (Object.keys(errors).length > 0) {
      throw validationFailed(errors);
    }

    await this.db.transaction(async (tx) => {
      await this.applyTransition(tx, current, 'PENDING_REVIEW', now, {
        submittedAt: now,
      });
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: user.id },
        action: 'SUBMISSION_RESUBMITTED',
        target: { type: 'SUBMISSION', id },
        metadata: { fromStatus: current.status },
        at: now,
      });
    });
    return this.detail(id, now, user);
  }

  async cancel(
    user: AuthUser,
    id: string,
    version: number,
  ): Promise<SubmissionDetailDto> {
    const now = new Date();
    const current = await this.findOwnRow(user, id, version);
    if (!canCancel(current.status, current.startAt, now)) {
      throw conflict(`Submission in ${current.status} cannot be canceled`);
    }

    await this.db.transaction(async (tx) => {
      await this.applyTransition(tx, current, 'CANCELED', now);
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: user.id },
        action: 'SUBMISSION_CANCELED',
        target: { type: 'SUBMISSION', id },
        metadata: { fromStatus: current.status },
        at: now,
      });
    });
    return this.detail(id, now, user);
  }

  /**
   * 작성자를 가리는 신청의 작성자. 열람할 때마다 감사 로그를 남기고, 작성자는 로그에 넣지 않는다
   * (감사 로그는 REVIEWER도 읽는다). 권한(SUPER_ADMIN) 확인은 컨트롤러가 한다.
   */
  async revealAuthor(
    admin: AuthUser,
    id: string,
  ): Promise<SubmissionAuthorDto> {
    const now = new Date();
    const [row] = await this.db
      .select({
        type: submissions.type,
        requesterId: users.id,
        requesterName: users.name,
        requesterEmail: users.email,
      })
      .from(submissions)
      .innerJoin(users, eq(users.id, submissions.requesterId))
      .where(eq(submissions.id, id));
    if (!row) {
      throw notFound();
    }
    if (!kindOf(row.type).anonymous) {
      throw conflict('Author of this submission is not hidden');
    }

    await this.db.transaction((tx) =>
      this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'STORY_AUTHOR_REVEALED',
        target: { type: 'SUBMISSION', id },
        at: now,
      }),
    );
    const { type: _, ...author } = row;
    return author;
  }

  /**
   * 검토 대기열 (요구사항 6.1). 오래 기다린 순(검토 요청 시각 오름차순)이다.
   * 권한 확인은 호출하는 쪽(검토 API)이 한다.
   */
  async listReviewQueue(
    viewer: AuthUser,
    query: ReviewQueueQueryDto,
  ): Promise<Page<SubmissionDto>> {
    const now = new Date();
    const filter = and(
      eq(submissions.status, query.status),
      query.categoryId
        ? eq(submissions.categoryId, query.categoryId)
        : undefined,
      typeCondition(query.type),
    );

    let pageFilter = filter;
    if (query.cursor) {
      const [since, id] = decodeCursor(query.cursor, cursorSchema);
      pageFilter = and(
        filter,
        sql`(${waitingSince}, ${submissions.id}) > (${since}::timestamptz, ${id}::uuid)`,
      );
    }

    const [rows, [{ total }]] = await Promise.all([
      selectSubmissionRows(this.db, pageFilter)
        .orderBy(asc(waitingSince), asc(submissions.id))
        .limit(query.limit + 1),
      this.db.select({ total: count() }).from(submissions).where(filter),
    ]);
    const [groupIds, details] = await Promise.all([
      this.targetGroupIdsOf(rows.map((row) => row.id)),
      this.detailsOf(rows),
    ]);

    return toPage(rows, {
      limit: query.limit,
      totalCount: total,
      serverTime: now,
      cursorOf: (row) => [
        (row.submittedAt ?? row.createdAt).toISOString(),
        row.id,
      ],
      map: (row) =>
        this.toDto(
          viewer,
          row,
          groupIds.get(row.id) ?? [],
          details.get(row.id),
        ),
    });
  }

  /**
   * version이 그대로일 때만 상태를 바꾼다. 그 사이 다른 요청이 먼저 바꿨으면 409.
   * 검토 API도 이 메서드로 상태를 바꾸고, 같은 tx에서 검토 이력과 감사 로그를 쓴다.
   */
  async applyTransition(
    tx: Transaction,
    current: Submission,
    status: SubmissionStatus,
    now: Date,
    extra: Partial<typeof submissions.$inferInsert> = {},
  ): Promise<void> {
    const [updated] = await tx
      .update(submissions)
      .set({ ...extra, status, version: current.version + 1, updatedAt: now })
      .where(
        and(
          eq(submissions.id, current.id),
          eq(submissions.version, current.version),
        ),
      )
      .returning({ id: submissions.id });
    if (!updated) {
      throw conflict('Submission was modified');
    }
  }

  // ---------------------------------------------------------------------------

  /** 본인 신청을 찾고 version을 확인한다. 순서: 404 → 409 */
  private async findOwnRow(
    user: AuthUser,
    id: string,
    version: number,
  ): Promise<SubmissionRow> {
    const row = await this.findRow(id);
    if (!row || row.requesterId !== user.id) {
      throw notFound();
    }
    if (row.version !== version) {
      throw conflict('Submission was modified');
    }
    return row;
  }

  async findRow(id: string): Promise<SubmissionRow | undefined> {
    const [row] = await selectSubmissionRows(this.db, eq(submissions.id, id));
    return row;
  }

  private async targetGroupIdsOf(
    ids: string[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (ids.length === 0) {
      return result;
    }
    const rows = await this.db
      .select()
      .from(submissionTargetGroups)
      .where(inArray(submissionTargetGroups.submissionId, ids))
      .orderBy(submissionTargetGroups.targetGroupId);
    for (const row of rows) {
      const list = result.get(row.submissionId) ?? [];
      list.push(row.targetGroupId);
      result.set(row.submissionId, list);
    }
    return result;
  }

  /** 단건 응답. viewer에 따라 작성자를 가린다(toDto) */
  async detail(
    id: string,
    now: Date,
    viewer: AuthUser,
  ): Promise<SubmissionDetailDto> {
    const row = await this.findRow(id);
    if (!row) {
      throw notFound();
    }
    const [groups, details] = await Promise.all([
      this.targetGroupIdsOf([id]),
      this.detailsOf([row]),
    ]);
    return {
      ...this.toDto(viewer, row, groups.get(id) ?? [], details.get(id)),
      serverTime: now.toISOString(),
    };
  }

  /** 종류별 상세 테이블을 종류마다 한 번씩 읽는다. 상세가 없는 종류는 비어 있다 */
  private async detailsOf(
    rows: Pick<SubmissionRow, 'id' | 'type'>[],
  ): Promise<Map<string, unknown>> {
    const idsByType = new Map<SubmissionType, string[]>();
    for (const row of rows) {
      idsByType.set(row.type, [...(idsByType.get(row.type) ?? []), row.id]);
    }
    const maps = await Promise.all(
      [...idsByType].map(
        ([type, ids]) =>
          kindOf(type).details?.load(this.db, ids) ??
          Promise.resolve(new Map<string, unknown>()),
      ),
    );
    return new Map(maps.flatMap((map) => [...map]));
  }

  /** 작성자를 가리는 종류는 이 한 곳에서 가린다. 본인 말고는 검토자도 보지 못한다 */
  private toDto(
    viewer: AuthUser,
    row: SubmissionRow,
    targetGroupIds: string[],
    detail: unknown,
  ): SubmissionDto {
    const kind = kindOf(row.type);
    const hideRequester = kind.anonymous && viewer.id !== row.requesterId;
    return {
      id: row.id,
      requesterId: hideRequester ? null : row.requesterId,
      requesterName: hideRequester ? null : row.requesterName,
      type: row.type,
      title: row.title,
      ...kind.toResponse(row, detail ?? null, this.assetsService),
      startAt: row.startAt?.toISOString() ?? null,
      endAt: row.endAt?.toISOString() ?? null,
      status: row.status,
      priority: row.priority,
      targetGroupIds,
      version: row.version,
      lastDecision: row.lastDecision,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 종류 정의가 쓰는 조회. 정의가 DB와 서비스를 직접 알지 않게 한다 */
  private kindContext(user: AuthUser): KindContext {
    return {
      findOwnedAsset: (assetId) =>
        this.assetsService.findOwnedOrNull(user.id, assetId),
      isActiveCategory: (categoryId) =>
        this.categoriesService.isActive(categoryId),
    };
  }

  private async validateTargetGroups(ids: string[]): Promise<FieldErrors> {
    if (ids.length === 0) {
      return {};
    }
    const unavailable = await this.targetGroupsService.findUnavailable(ids);
    return unavailable.length > 0
      ? {
          targetGroupIds: `선택할 수 없는 대상 위치가 있습니다: ${unavailable.join(', ')}`,
        }
      : {};
  }

  /**
   * 사용자당 서울 하루 생성 한도. 같은 사용자·종류의 생성을 잠금으로 줄 세운 뒤 세므로
   * 동시에 보내도 한도를 넘지 못한다. 취소·반려된 신청도 센다(만들고 지우기로 한도를 피하지 못하게).
   */
  private async assertDailyLimit(
    tx: Transaction,
    user: AuthUser,
    kind: SubmissionKind,
    now: Date,
  ): Promise<void> {
    const limit = kind.dailyLimit;
    if (limit === null) {
      return;
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(${DAILY_LIMIT_LOCK_NAMESPACE}::int, hashtext(${`${user.id}:${kind.type}`}))`,
    );
    const [{ total }] = await tx
      .select({ total: count() })
      .from(submissions)
      .where(
        and(
          eq(submissions.requesterId, user.id),
          eq(submissions.type, kind.type),
          gte(submissions.createdAt, startOfSeoulDay(seoulDate(now))),
        ),
      );
    if (total >= limit) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.DAILY_LIMIT_EXCEEDED,
        `Daily ${kind.type} limit exceeded`,
        undefined,
        { type: kind.type, limit },
      );
    }
  }

  /** 같은 공지로 동시에 신청해도 DB unique 제약이 하나만 통과시킨다. 그 위반을 409로 바꾼다. */
  private async withNoticeGuard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (violatesUnique(error, ACTIVE_NOTICE_INDEX)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.ALREADY_SUBMITTED,
          'A submission for this notice already exists',
          { detailUrl: '이 공지로 이미 신청한 게시물이 있습니다.' },
        );
      }
      throw error;
    }
  }

  private assertScope(user: AuthUser, scope: SubmissionScope): void {
    if (scope === 'all' && !isReviewer(user.roles)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Only reviewers can view all submissions',
      );
    }
  }

  private scopeCondition(user: AuthUser, scope: SubmissionScope) {
    return scope === 'me' ? eq(submissions.requesterId, user.id) : undefined;
  }
}

/** 입력 중 종류마다 다른 부분 */
function kindInputOf(
  dto: CreateSubmissionDto | UpdateSubmissionDto,
): KindInput {
  return Object.fromEntries(
    KIND_INPUT_FIELDS.map((field) => [field, dto[field]]),
  ) as KindInput;
}

/**
 * 그 종류가 받지 않는 필드를 보냈으면 필드마다 오류. null과 빈 대상 위치는 보내지 않은 것으로 본다.
 * 기간을 승인 때 정하는 종류는 기간을, 대상 위치가 없는 종류는 대상 위치를 받지 않는다.
 */
function unacceptedFields(
  kind: SubmissionKind,
  dto: CreateSubmissionDto | UpdateSubmissionDto,
): FieldErrors {
  const unaccepted: string[] = KIND_INPUT_FIELDS.filter(
    (field) => dto[field] != null && !kind.inputFields.includes(field),
  );
  if (kind.schedule.mode === 'ON_APPROVAL') {
    unaccepted.push(
      ...(['startAt', 'endAt'] as const).filter((field) => dto[field] != null),
    );
  }
  if (!kind.targetable && dto.targetGroupIds?.length) {
    unaccepted.push('targetGroupIds');
  }
  return Object.fromEntries(
    unaccepted.map((field) => [
      field,
      '이 종류의 신청에는 쓸 수 없는 항목입니다.',
    ]),
  );
}

/** 신청자가 정한 기간의 규칙. 승인 때 기간을 정하는 종류는 검사할 것이 없다 */
function validateSchedule(
  kind: SubmissionKind,
  period: { startAt: Date | null; endAt: Date | null },
  now: Date,
): FieldErrors {
  return kind.schedule.mode === 'REQUESTED'
    ? kind.schedule.validate(period.startAt!, period.endAt!, now)
    : {};
}

function kindColumnsOf(row: SubmissionRow): KindColumns {
  return {
    title: row.title,
    categoryId: row.categoryId,
    assetId: row.assetId,
    detailUrl: row.detailUrl,
    ziggleNoticeId: row.ziggleNoticeId,
    organizerName: row.organizerName,
    subtitle: row.subtitle,
    location: row.location,
    description: row.description,
  };
}

function typeCondition(types: SubmissionType[] | undefined): SQL | undefined {
  return types?.length ? inArray(submissions.type, types) : undefined;
}

function notResubmittable(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.NOT_RESUBMITTABLE,
    'This kind cannot be resubmitted after review. Write a new one',
  );
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Submission not found',
  );
}

function conflict(message: string): AppException {
  return new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  return a === b;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
