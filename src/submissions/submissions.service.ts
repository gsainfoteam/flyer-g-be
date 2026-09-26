import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AssetsService } from '../assets/assets.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { CategoriesService } from '../categories/categories.service.js';
import {
  AppException,
  type FieldErrors,
} from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { validationFailed } from '../common/errors/validation.js';
import { decodeCursor } from '../common/pagination/cursor.js';
import { toPage, type Page } from '../common/pagination/page.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import {
  categories,
  submissionStatusEnum,
  submissionTargetGroups,
  submissions,
  type Submission,
  type SubmissionStatus,
} from '../db/schema.js';
import { TargetGroupsService } from '../target-groups/target-groups.service.js';
import type {
  CreateSubmissionDto,
  UpdateSubmissionDto,
} from './dto/submission-input.dto.js';
import type {
  ListSubmissionsQueryDto,
  SubmissionScope,
} from './dto/submission-query.dto.js';
import type {
  SubmissionDetailDto,
  SubmissionDto,
  SubmissionSummaryDto,
} from './dto/submission.dto.js';
import {
  canCancel,
  EDITABLE_STATUSES,
  hasStartedPublishing,
  parseDetailUrl,
  REAPPROVAL_STATUSES,
  SUBMITTABLE_STATUSES,
  validateSchedule,
} from './submission-rules.js';

type SubmissionRow = Submission & { categoryName: string };

const ACTIVE_NOTICE_INDEX = 'submissions_ziggle_notice_id_active_uq';
const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

@Injectable()
export class SubmissionsService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly assetsService: AssetsService,
    private readonly categoriesService: CategoriesService,
    private readonly targetGroupsService: TargetGroupsService,
  ) {}

  /** 생성과 제출을 한 번에 한다. 만들어지면 바로 검토 대기다. */
  async create(
    user: AuthUser,
    dto: CreateSubmissionDto,
  ): Promise<SubmissionDetailDto> {
    const now = new Date();
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    const targetGroupIds = dto.targetGroupIds ?? [];

    const errors: FieldErrors = {
      ...validateSchedule(startAt, endAt, now),
      ...(await this.validateReferences(user.id, {
        categoryId: dto.categoryId,
        assetId: dto.assetId,
        targetGroupIds,
      })),
    };
    const detail = this.parseDetail(dto.detailUrl, errors);
    if (Object.keys(errors).length > 0) {
      throw validationFailed(errors);
    }

    const id = await this.withNoticeGuard(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(submissions)
          .values({
            requesterId: user.id,
            ziggleNoticeId: detail?.ziggleNoticeId ?? null,
            title: dto.title,
            categoryId: dto.categoryId,
            assetId: dto.assetId,
            detailUrl: detail?.url ?? null,
            startAt,
            endAt,
            status: 'PENDING_REVIEW',
            organizerName: dto.organizerName ?? null,
            subtitle: dto.subtitle ?? null,
            location: dto.location ?? null,
            description: dto.description ?? null,
            submittedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: submissions.id });
        if (targetGroupIds.length > 0) {
          await tx.insert(submissionTargetGroups).values(
            targetGroupIds.map((targetGroupId) => ({
              submissionId: row.id,
              targetGroupId,
            })),
          );
        }
        return row.id;
      }),
    );

    return this.detail(id, now);
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
      this.selectRows(pageFilter)
        .orderBy(desc(submissions.createdAt), desc(submissions.id))
        .limit(query.limit + 1),
      this.db.select({ total: count() }).from(submissions).where(filter),
    ]);
    const groupIds = await this.targetGroupIdsOf(rows.map((row) => row.id));

    return toPage(rows, {
      limit: query.limit,
      totalCount: total,
      serverTime: now,
      cursorOf: (row) => [row.createdAt.toISOString(), row.id],
      map: (row) => this.toDto(row, groupIds.get(row.id) ?? []),
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

    const [byStatusRows, [effective]] = await Promise.all([
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
    ]);

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
    };
  }

  /** 신청자 본인이나 검토자만 본다. 그 외에는 존재 여부도 알리지 않는다(404). */
  async findOne(user: AuthUser, id: string): Promise<SubmissionDetailDto> {
    const row = await this.findRow(id);
    if (!row || (row.requesterId !== user.id && !isReviewer(user))) {
      throw notFound();
    }
    return this.detail(id, new Date());
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

    const errors: FieldErrors = {};
    const changes: Partial<typeof submissions.$inferInsert> = {};
    const setIfChanged = <K extends keyof Submission>(
      key: K,
      value: Submission[K] | undefined,
    ) => {
      if (value !== undefined && !sameValue(value, current[key])) {
        (changes as Record<string, unknown>)[key] = value;
      }
    };

    setIfChanged('title', dto.title);
    setIfChanged('categoryId', dto.categoryId);
    setIfChanged('assetId', dto.assetId);
    setIfChanged('organizerName', dto.organizerName);
    setIfChanged('subtitle', dto.subtitle);
    setIfChanged('location', dto.location);
    setIfChanged('description', dto.description);
    setIfChanged('startAt', dto.startAt ? new Date(dto.startAt) : undefined);
    setIfChanged('endAt', dto.endAt ? new Date(dto.endAt) : undefined);
    if (dto.detailUrl !== undefined) {
      const detail =
        dto.detailUrl === null ? null : this.parseDetail(dto.detailUrl, errors);
      setIfChanged('detailUrl', detail?.url ?? null);
      setIfChanged('ziggleNoticeId', detail?.ziggleNoticeId ?? null);
    }

    const currentGroups = (await this.targetGroupIdsOf([id])).get(id) ?? [];
    const groupsChanged =
      dto.targetGroupIds !== undefined &&
      !sameSet(dto.targetGroupIds, currentGroups);

    if (Object.keys(changes).length === 0 && !groupsChanged) {
      if (Object.keys(errors).length > 0) {
        throw validationFailed(errors);
      }
      return this.detail(id, now);
    }

    const needsReapproval = REAPPROVAL_STATUSES.includes(current.status);
    const nextStatus = needsReapproval ? 'PENDING_REVIEW' : current.status;
    if (changes.startAt || changes.endAt || needsReapproval) {
      Object.assign(
        errors,
        validateSchedule(
          changes.startAt ?? current.startAt,
          changes.endAt ?? current.endAt,
          now,
        ),
      );
    }
    Object.assign(
      errors,
      await this.validateReferences(user.id, {
        categoryId: changes.categoryId,
        assetId: changes.assetId,
        targetGroupIds: groupsChanged ? dto.targetGroupIds : undefined,
      }),
    );
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
      }),
    );

    return this.detail(id, now);
  }

  /** 반려된 신청을 고친 뒤 다시 검토를 요청한다. */
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
    const errors = validateSchedule(current.startAt, current.endAt, now);
    if (Object.keys(errors).length > 0) {
      throw validationFailed(errors);
    }

    await this.transition(current, 'PENDING_REVIEW', now, { submittedAt: now });
    return this.detail(id, now);
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

    await this.transition(current, 'CANCELED', now);
    return this.detail(id, now);
  }

  // ---------------------------------------------------------------------------

  private async transition(
    current: Submission,
    status: SubmissionStatus,
    now: Date,
    extra: Partial<typeof submissions.$inferInsert> = {},
  ): Promise<void> {
    const [updated] = await this.withNoticeGuard(() =>
      this.db
        .update(submissions)
        .set({ ...extra, status, version: current.version + 1, updatedAt: now })
        .where(
          and(
            eq(submissions.id, current.id),
            eq(submissions.version, current.version),
          ),
        )
        .returning({ id: submissions.id }),
    );
    if (!updated) {
      throw conflict('Submission was modified');
    }
  }

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

  private async findRow(id: string): Promise<SubmissionRow | undefined> {
    const [row] = await this.selectRows(eq(submissions.id, id));
    return row;
  }

  private selectRows(where: SQL | undefined) {
    return this.db
      .select({
        id: submissions.id,
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
      })
      .from(submissions)
      .innerJoin(categories, eq(categories.id, submissions.categoryId))
      .where(where)
      .$dynamic();
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

  private async detail(id: string, now: Date): Promise<SubmissionDetailDto> {
    const row = await this.findRow(id);
    if (!row) {
      throw notFound();
    }
    const groups = (await this.targetGroupIdsOf([id])).get(id) ?? [];
    return { ...this.toDto(row, groups), serverTime: now.toISOString() };
  }

  private toDto(row: SubmissionRow, targetGroupIds: string[]): SubmissionDto {
    const poster = this.assetsService.variantUrls(row.assetId);
    return {
      id: row.id,
      ziggleNoticeId: row.ziggleNoticeId,
      requesterId: row.requesterId,
      type: 'POSTER',
      title: row.title,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      assetId: row.assetId,
      posterUrl: poster.preview,
      posterThumbUrl: poster.thumb,
      detailUrl: row.detailUrl,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      status: row.status,
      priority: row.priority,
      targetGroupIds,
      organizerName: row.organizerName,
      subtitle: row.subtitle,
      location: row.location,
      description: row.description,
      version: row.version,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 입력으로 들어온 참조가 쓸 수 있는 값인지. undefined인 항목은 검사하지 않는다. */
  private async validateReferences(
    ownerId: string,
    refs: { categoryId?: string; assetId?: string; targetGroupIds?: string[] },
  ): Promise<FieldErrors> {
    const errors: FieldErrors = {};
    const [categoryOk, asset, unavailableGroups] = await Promise.all([
      refs.categoryId === undefined
        ? true
        : this.categoriesService.isActive(refs.categoryId),
      refs.assetId === undefined
        ? undefined
        : this.assetsService.findOwnedOrNull(ownerId, refs.assetId),
      refs.targetGroupIds === undefined
        ? []
        : this.targetGroupsService.findUnavailable(refs.targetGroupIds),
    ]);

    if (!categoryOk) {
      errors.categoryId = '선택할 수 없는 카테고리입니다.';
    }
    if (refs.assetId !== undefined && asset?.status !== 'READY') {
      errors.assetId =
        asset?.status === 'PENDING_UPLOAD'
          ? '포스터 업로드가 끝나지 않았습니다.'
          : '포스터를 다시 올려주세요.';
    }
    if (unavailableGroups.length > 0) {
      errors.targetGroupIds = `선택할 수 없는 대상 위치가 있습니다: ${unavailableGroups.join(', ')}`;
    }
    return errors;
  }

  private parseDetail(raw: string | null | undefined, errors: FieldErrors) {
    if (!raw) {
      return null;
    }
    const parsed = parseDetailUrl(raw);
    if ('error' in parsed) {
      errors.detailUrl = parsed.error;
      return null;
    }
    return parsed;
  }

  /** 같은 공지로 동시에 신청해도 DB unique 제약이 하나만 통과시킨다. 그 위반을 409로 바꾼다. */
  private async withNoticeGuard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (violatesConstraint(error, ACTIVE_NOTICE_INDEX)) {
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
    if (scope === 'all' && !isReviewer(user)) {
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

function isReviewer(user: AuthUser): boolean {
  return user.roles.includes('REVIEWER') || user.roles.includes('SUPER_ADMIN');
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

/** drizzle이 감싼 postgres 오류까지 따라가 unique 제약 위반을 찾는다. */
function violatesConstraint(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    const { code, constraint_name } = current as {
      code?: string;
      constraint_name?: string;
    };
    if (code === '23505' && constraint_name === constraint) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
