import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, between, desc, eq, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/types/auth-user.js';
import { isReviewer } from '../auth/types/role.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { validationFailed } from '../common/errors/validation.js';
import { addSeoulDays, seoulDate } from '../common/time/seoul-time.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { jobWatermarks, playEventDaily, submissions } from '../db/schema.js';
import { PLAY_EVENT_WATERMARK } from '../jobs/play-event-aggregation.job.js';
import type {
  ImpressionStatsDto,
  ImpressionStatsQueryDto,
} from './dto/impressions.dto.js';

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;

/**
 * 노출 통계 (요구사항 7.2, FR-DASH-03). 일별 집계 테이블을 읽는다.
 * "조회수"가 아니라 디스플레이가 정상 렌더링한 횟수다.
 */
@Injectable()
export class StatsService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async impressions(
    user: AuthUser,
    query: ImpressionStatsQueryDto,
  ): Promise<ImpressionStatsDto> {
    if (query.scope === 'all' && !isReviewer(user.roles)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Only reviewers can view all impression stats',
      );
    }
    const { from, to } = resolveRange(query.from, query.to, new Date());

    const [rows, [watermark]] = await Promise.all([
      this.db
        .select({
          submissionId: playEventDaily.submissionId,
          title: submissions.title,
          impressions: sql<number>`sum(${playEventDaily.impressions})`.mapWith(
            Number,
          ),
          completedImpressions:
            sql<number>`sum(${playEventDaily.completedImpressions})`.mapWith(
              Number,
            ),
          deviceCount:
            sql<number>`count(distinct ${playEventDaily.deviceId})`.mapWith(
              Number,
            ),
        })
        .from(playEventDaily)
        .innerJoin(submissions, eq(submissions.id, playEventDaily.submissionId))
        .where(
          and(
            between(playEventDaily.day, from, to),
            query.scope === 'me'
              ? eq(submissions.requesterId, user.id)
              : undefined,
          ),
        )
        .groupBy(playEventDaily.submissionId, submissions.title)
        .orderBy(
          desc(sql`sum(${playEventDaily.impressions})`),
          playEventDaily.submissionId,
        ),
      this.db
        .select({ value: jobWatermarks.value })
        .from(jobWatermarks)
        .where(eq(jobWatermarks.name, PLAY_EVENT_WATERMARK)),
    ]);

    return {
      from,
      to,
      aggregatedAt: watermark?.value.toISOString() ?? null,
      items: rows,
    };
  }
}

/** 기본은 오늘까지 30일. 날짜는 실제로 있는 날이어야 하고 최대 366일까지 본다. */
export function resolveRange(
  fromInput: string | undefined,
  toInput: string | undefined,
  now: Date,
): { from: string; to: string } {
  const errors: Record<string, string> = {};
  for (const [field, value] of [
    ['from', fromInput],
    ['to', toInput],
  ] as const) {
    if (value !== undefined && !isRealDate(value)) {
      errors[field] = '없는 날짜입니다.';
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validationFailed(errors);
  }

  const to = toInput ?? seoulDate(now);
  const from = fromInput ?? addSeoulDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) {
    throw validationFailed({ from: '시작 날짜가 끝 날짜보다 늦습니다.' });
  }
  if (addSeoulDays(from, MAX_RANGE_DAYS - 1) < to) {
    throw validationFailed({
      from: `기간은 최대 ${MAX_RANGE_DAYS}일입니다.`,
    });
  }
  return { from, to };
}

function isRealDate(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day)
  );
}
