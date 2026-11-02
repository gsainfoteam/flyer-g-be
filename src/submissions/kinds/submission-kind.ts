import { createHash } from 'node:crypto';
import type { AssetsService } from '../../assets/assets.service.js';
import type { FieldErrors } from '../../common/errors/app.exception.js';
import type { Database, Transaction } from '../../db/index.js';
import type {
  Asset,
  Submission,
  SubmissionType,
  submissions,
} from '../../db/schema.js';
import type {
  EventBannerPlaylistItemDto,
  StoryPlaylistItemDto,
} from '../../playlist/dto/playlist-v2.dto.js';
import type { PlaylistItemDto } from '../../playlist/dto/playlist.dto.js';
import type { SubmissionDto } from '../dto/submission.dto.js';
import type { CreateSubmissionDto } from '../dto/submission-input.dto.js';
import type { SubmissionRow } from '../submissions.service.js';

/** 신청 입력 중 종류마다 다른 부분. 공통 필드(type·기간·대상 위치·version)는 서비스가 다룬다 */
export type KindInput = Pick<
  CreateSubmissionDto,
  | 'title'
  | 'categoryId'
  | 'assetId'
  | 'detailUrl'
  | 'organizerName'
  | 'subtitle'
  | 'location'
  | 'description'
  | 'eventBanner'
  | 'story'
>;

export type KindInputField = keyof KindInput;

export const KIND_INPUT_FIELDS: readonly KindInputField[] = [
  'title',
  'categoryId',
  'assetId',
  'detailUrl',
  'organizerName',
  'subtitle',
  'location',
  'description',
  'eventBanner',
  'story',
];

/** submissions 행 중 종류가 정하는 컬럼 */
export type KindColumns = Required<
  Pick<
    typeof submissions.$inferInsert,
    | 'title'
    | 'categoryId'
    | 'assetId'
    | 'detailUrl'
    | 'ziggleNoticeId'
    | 'organizerName'
    | 'subtitle'
    | 'location'
    | 'description'
  >
>;

/** 응답 중 종류가 채우는 부분. 그 종류와 상관없는 필드는 null이다 */
export type KindResponse = Pick<
  SubmissionDto,
  | 'categoryId'
  | 'categoryName'
  | 'assetId'
  | 'posterUrl'
  | 'posterThumbUrl'
  | 'posterKind'
  | 'posterWidth'
  | 'posterHeight'
  | 'posterDurationMs'
  | 'posterVideoUrl'
  | 'detailUrl'
  | 'ziggleNoticeId'
  | 'organizerName'
  | 'subtitle'
  | 'location'
  | 'description'
  | 'eventBanner'
  | 'story'
>;

/** 종류 정의가 DB·다른 서비스를 직접 모르게 서비스가 넘겨 주는 것 */
export interface KindContext {
  /** 본인 asset. 남의 것이거나 없으면 null */
  findOwnedAsset(assetId: string): Promise<Asset | null>;
  isActiveCategory(categoryId: string): Promise<boolean>;
}

export type MediaUrls = Pick<AssetsService, 'variantUrls' | 'videoUrl'>;

/** 지금 저장된 내용. 수정할 때 입력에 없는 필드는 이 값을 따른다 */
export type CurrentContent<Detail> = { columns: KindColumns; detail: Detail };

export type ResolvedContent<Detail> = {
  errors: FieldErrors;
  columns: KindColumns;
  detail: Detail;
};

/** 편성 응답에 싣는 신청 행. 게시 중인 것만 읽으므로 기간이 있다 */
export type PlaylistRow = Pick<
  Submission,
  | 'id'
  | 'type'
  | 'version'
  | 'title'
  | 'detailUrl'
  | 'priority'
  | 'subtitle'
  | 'location'
  | 'organizerName'
> & {
  startAt: Date;
  endAt: Date;
  categoryName: string | null;
  /** 주 미디어(submissions.asset_id). 편성에는 READY인 것만 실린다 */
  asset: Pick<
    Asset,
    'id' | 'kind' | 'width' | 'height' | 'durationMs' | 'hasAudio' | 'checksum'
  > | null;
};

/** 편성 응답 v2의 submissions[type] 항목 */
export type PlaylistSubmissionItem =
  PlaylistItemDto | EventBannerPlaylistItemDto | StoryPlaylistItemDto;

/** 종류만의 상세 테이블 (신청과 1:1) */
export interface DetailStore<Detail> {
  load(db: Database, ids: string[]): Promise<Map<string, Detail>>;
  /** 없으면 넣고 있으면 바꾼다 */
  save(tx: Transaction, submissionId: string, detail: Detail): Promise<void>;
  equals(a: Detail, b: Detail): boolean;
}

/**
 * - REQUESTED: 신청자가 기간을 보내고, 검토 대기에 들어갈 때(생성·재제출)와 기간을 바꿀 때 validate로 검사한다
 * - ON_APPROVAL: 기간을 받지 않는다(보내면 422). 승인 시각으로 정한다
 *
 * 기준 시각은 항상 서버 시각이다.
 */
export type KindSchedule =
  | {
      mode: 'REQUESTED';
      validate(startAt: Date, endAt: Date, now: Date): FieldErrors;
    }
  | {
      mode: 'ON_APPROVAL';
      periodFrom(approvedAt: Date): { startAt: Date; endAt: Date };
    };

/**
 * 심사받는 컨텐츠 종류 하나의 규칙. 공통 서비스는 종류를 모른 채 이 정의에 맡긴다.
 * 종류를 더할 때는 정의 파일을 만들고 kinds/index.ts의 SUBMISSION_KINDS에 한 줄 더한다.
 */
export interface SubmissionKind<Detail = unknown> {
  readonly type: SubmissionType;

  /** 이 종류가 받는 입력 필드. 그 밖의 종류별 필드를 보내면 422다 */
  readonly inputFields: readonly KindInputField[];

  /** 게시 기간을 누가 언제 정하나 */
  readonly schedule: KindSchedule;

  /** 대상 위치(targetGroupIds)를 받나. 받지 않으면 전체 기기에 나간다 */
  readonly targetable: boolean;

  /** 사용자당 서울 하루 생성 한도. 없으면 null. GET /signage/config에도 나간다 */
  readonly dailyLimit: number | null;

  /** 반려·중단된 뒤 고쳐서 다시 낼 수 있나. 없으면 새로 써야 한다 (409 NOT_RESUBMITTABLE) */
  readonly resubmittable: boolean;

  /** 작성자를 가리나. 가리면 본인이 아닌 사람(검토자 포함)에게 신청자 정보가 null로 나간다 */
  readonly anonymous: boolean;

  /**
   * 입력을 저장할 값으로 바꾸고 검증한다. 생성이면 current가 null이다.
   * 참조(카테고리·asset)는 current와 달라진 것만 검사한다. 이미 연결된 값은 그대로 둘 수 있다.
   */
  resolve(
    input: KindInput,
    current: CurrentContent<Detail> | null,
    ctx: KindContext,
  ): Promise<ResolvedContent<Detail>>;

  /** 상세 테이블. 없으면 submissions 컬럼만 쓴다 (detail은 null) */
  readonly details: DetailStore<Detail> | null;

  /** 승인 트랜잭션 안에서 부른다. 승인 때 정하는 값(제보 번호 등)을 채운다 */
  onApprove?(tx: Transaction, submissionId: string): Promise<void>;

  toResponse(
    row: SubmissionRow,
    detail: Detail,
    media: MediaUrls,
  ): KindResponse;

  /** 편성 응답 v2의 항목. 작성자 정보는 싣지 않는다 */
  toPlaylistItem(
    row: PlaylistRow,
    detail: Detail,
    media: MediaUrls,
  ): PlaylistSubmissionItem;
}

/** 다른 종류의 필드는 비운다. 정의마다 필요한 것만 덮어쓴다 */
export const EMPTY_KIND_COLUMNS: KindColumns = {
  title: '',
  categoryId: null,
  assetId: null,
  detailUrl: null,
  ziggleNoticeId: null,
  organizerName: null,
  subtitle: null,
  location: null,
  description: null,
};

export const EMPTY_KIND_RESPONSE: KindResponse = {
  categoryId: null,
  categoryName: null,
  assetId: null,
  posterUrl: null,
  posterThumbUrl: null,
  posterKind: null,
  posterWidth: null,
  posterHeight: null,
  posterDurationMs: null,
  posterVideoUrl: null,
  detailUrl: null,
  ziggleNoticeId: null,
  organizerName: null,
  subtitle: null,
  location: null,
  description: null,
  eventBanner: null,
  story: null,
};

/** 편성 항목의 공통 필드 */
export function playlistEntry(row: PlaylistRow, checksum: string) {
  return {
    submissionId: row.id,
    revision: row.version,
    startsAt: row.startAt.toISOString(),
    endsAt: row.endAt.toISOString(),
    checksum,
  };
}

/** 미디어만으로 정해지지 않는 항목(문구가 있는 것)의 checksum. 내용이 같으면 같다 */
export function contentChecksum(content: Record<string, unknown>): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(content)).digest('hex')}`;
}

/** 수정 입력: undefined면 지금 값, null이면 비움 */
export function patched<T>(
  value: T | null | undefined,
  current: T | null,
): T | null {
  return value === undefined ? current : value;
}
