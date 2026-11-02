import type { FieldErrors } from '../../common/errors/app.exception.js';
import type { SubmissionType } from '../../db/schema.js';

/**
 * 심사받는 컨텐츠 종류 하나의 규칙. 공통 서비스는 종류를 모른 채 이 정의에 맡긴다.
 * 종류를 더할 때는 정의 파일을 만들고 kinds/index.ts의 SUBMISSION_KINDS에 한 줄 더한다.
 */
export interface SubmissionKind {
  readonly type: SubmissionType;

  /**
   * 게시 기간 규칙. 검토 대기에 들어갈 때(생성·재제출)와 기간을 바꿀 때 검사한다.
   * 기준 시각은 항상 서버 시각이다.
   */
  validateSchedule(startAt: Date, endAt: Date, now: Date): FieldErrors;

  /** 사용자당 서울 하루 생성 한도. 없으면 null. GET /signage/config에도 나간다 */
  readonly dailyLimit: number | null;
}
