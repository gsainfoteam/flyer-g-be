import { Trace } from '@gsainfoteam/nest-observability';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, lte } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { submissionStories, submissions } from '../db/schema.js';
import type { RecentStoriesDto } from './dto/recent-stories.dto.js';

@Trace()
@Injectable()
export class StoriesService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** 지금 게시 중인 제보를 최근 승인 순으로. 남의 신청을 읽을 수 없는 사용자 홈의 "최근 소식"용이다 */
  async recent(limit: number): Promise<RecentStoriesDto> {
    const now = new Date();
    const rows = await this.db
      .select({
        storyNumber: submissionStories.storyNumber,
        tag: submissionStories.tag,
        body: submissionStories.body,
        startAt: submissions.startAt,
      })
      .from(submissions)
      .innerJoin(
        submissionStories,
        eq(submissionStories.submissionId, submissions.id),
      )
      .where(
        and(
          eq(submissions.type, 'STORY'),
          // 배치가 상태를 늦게 바꿔도 맞도록 기간으로 판정한다
          inArray(submissions.status, ['APPROVED', 'SCHEDULED', 'PUBLISHED']),
          lte(submissions.startAt, now),
          gt(submissions.endAt, now),
        ),
      )
      .orderBy(desc(submissions.startAt), desc(submissions.id))
      .limit(limit);

    return {
      // 승인된 제보는 번호와 기간이 있다
      items: rows.map((row) => ({
        storyNumber: row.storyNumber!,
        tag: row.tag,
        body: row.body,
        startAt: row.startAt!.toISOString(),
      })),
    };
  }
}
