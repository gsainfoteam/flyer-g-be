import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AssetsService } from '../assets/assets.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { isReviewer } from '../auth/types/role.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import {
  reviews,
  users,
  type RejectReasonCode,
  type SubmissionStatus,
} from '../db/schema.js';
import type { SubmissionDetailDto } from '../submissions/dto/submission.dto.js';
import {
  SubmissionsService,
  type SubmissionRow,
} from '../submissions/submissions.service.js';
import type { ReviewDto } from './dto/review.dto.js';

/** 운영자가 게시를 중단할 수 있는 상태 (FR-REV-05) */
const SUSPENDABLE_STATUSES: readonly SubmissionStatus[] = [
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
];

/**
 * 검토와 승인 (요구사항 6절). 상태 변경·검토 이력·감사 로그를 한 트랜잭션에 쓴다.
 * 동시에 두 검토자가 처리하면 version 조건 때문에 한쪽만 성공하고 다른 쪽은 409다.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly submissionsService: SubmissionsService,
    private readonly assetsService: AssetsService,
    private readonly auditService: AuditService,
  ) {}

  /** 시작 시각이 지났으면 바로 게시 중, 아니면 예약이다. 프론트는 이 응답 상태를 그대로 쓴다. */
  async approve(
    reviewer: AuthUser,
    id: string,
    revision: number,
  ): Promise<SubmissionDetailDto> {
    const now = new Date();
    const current = await this.findPending(id, revision);
    if (current.endAt <= now) {
      throw conflict('Publish period has already ended');
    }
    // 신청은 READY asset만 가리킬 수 있지만, 승인 시점의 미디어를 한 번 더 확인하고 checksum을 고정한다.
    const asset = await this.assetsService.findById(current.assetId);
    if (asset?.status !== 'READY' || !asset.checksum) {
      throw conflict('Poster is not available');
    }

    const status = current.startAt <= now ? 'PUBLISHED' : 'SCHEDULED';
    await this.db.transaction(async (tx) => {
      await this.submissionsService.applyTransition(tx, current, status, now);
      await tx.insert(reviews).values({
        submissionId: id,
        revision: current.version,
        decision: 'APPROVED',
        reviewerId: reviewer.id,
        assetChecksum: asset.checksum,
        reviewedAt: now,
      });
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: reviewer.id },
        action: 'SUBMISSION_APPROVED',
        target: { type: 'SUBMISSION', id },
        metadata: {
          revision: current.version,
          toStatus: status,
          assetChecksum: asset.checksum,
        },
        at: now,
      });
    });
    return this.submissionsService.detail(id, now);
  }

  async reject(
    reviewer: AuthUser,
    id: string,
    revision: number,
    reasonCode: RejectReasonCode,
    comment: string,
  ): Promise<SubmissionDetailDto> {
    const now = new Date();
    const current = await this.findPending(id, revision);

    await this.db.transaction(async (tx) => {
      await this.submissionsService.applyTransition(
        tx,
        current,
        'REJECTED',
        now,
      );
      await tx.insert(reviews).values({
        submissionId: id,
        revision: current.version,
        decision: 'REJECTED',
        reasonCode,
        comment,
        reviewerId: reviewer.id,
        reviewedAt: now,
      });
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: reviewer.id },
        action: 'SUBMISSION_REJECTED',
        target: { type: 'SUBMISSION', id },
        reason: comment,
        metadata: { revision: current.version, reasonCode },
        at: now,
      });
    });
    return this.submissionsService.detail(id, now);
  }

  /**
   * 승인된 게시를 내린다. 급하게 내리는 경우라 revision을 받지 않는다.
   * 기기에는 다음 편성 동기화 때 반영된다.
   */
  async suspend(
    reviewer: AuthUser,
    id: string,
    reason: string,
  ): Promise<SubmissionDetailDto> {
    const now = new Date();
    const current = await this.findExisting(id);
    if (
      !SUSPENDABLE_STATUSES.includes(current.status) ||
      current.endAt <= now
    ) {
      throw conflict(`Submission in ${current.status} cannot be suspended`);
    }

    await this.db.transaction(async (tx) => {
      await this.submissionsService.applyTransition(
        tx,
        current,
        'SUSPENDED',
        now,
      );
      await tx.insert(reviews).values({
        submissionId: id,
        revision: current.version,
        decision: 'SUSPENDED',
        comment: reason,
        reviewerId: reviewer.id,
        reviewedAt: now,
      });
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: reviewer.id },
        action: 'SUBMISSION_SUSPENDED',
        target: { type: 'SUBMISSION', id },
        reason,
        metadata: { revision: current.version, fromStatus: current.status },
        at: now,
      });
    });
    return this.submissionsService.detail(id, now);
  }

  /** 검토 이력. 신청자 본인과 검토자만 본다. 오래된 것부터 (상세 화면 타임라인 순서). */
  async history(user: AuthUser, id: string): Promise<ReviewDto[]> {
    const row = await this.submissionsService.findRow(id);
    if (!row || (row.requesterId !== user.id && !isReviewer(user.roles))) {
      throw notFound();
    }

    const rows = await this.db
      .select({
        id: reviews.id,
        submissionId: reviews.submissionId,
        revision: reviews.revision,
        decision: reviews.decision,
        reasonCode: reviews.reasonCode,
        comment: reviews.comment,
        reviewerId: reviews.reviewerId,
        reviewerName: users.name,
        reviewedAt: reviews.reviewedAt,
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.reviewerId))
      .where(eq(reviews.submissionId, id))
      .orderBy(asc(reviews.reviewedAt), asc(reviews.id));

    return rows.map((review) => ({
      ...review,
      reviewedAt: review.reviewedAt.toISOString(),
    }));
  }

  private async findExisting(id: string): Promise<SubmissionRow> {
    const row = await this.submissionsService.findRow(id);
    if (!row) {
      throw notFound();
    }
    return row;
  }

  /** 검토 대기이고 검토자가 본 version 그대로인 신청. 순서: 404 → 409(version) → 409(상태) */
  private async findPending(
    id: string,
    revision: number,
  ): Promise<SubmissionRow> {
    const row = await this.findExisting(id);
    if (row.version !== revision) {
      throw conflict('Submission was modified or already reviewed');
    }
    if (row.status !== 'PENDING_REVIEW') {
      throw conflict(`Submission in ${row.status} cannot be reviewed`);
    }
    return row;
  }
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
