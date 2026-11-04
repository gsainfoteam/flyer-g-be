/**
 * DB 테이블 정의. 이 파일이 스키마의 유일한 기준(single source of truth)이다.
 *
 * 테이블을 추가/수정한 뒤 `bun run db:generate`를 실행하면
 * drizzle/ 폴더에 마이그레이션 SQL이 생성된다.
 * 그 SQL은 앱이 시작될 때 자동으로 실행된다(src/db/db.module.ts 참고).
 */

import { sql } from 'drizzle-orm';
import type { NowPlaying } from '../devices/dto/now-playing.dto.js';
import type { LiveAlert, LiveMain } from '../live/live-schema.js';
import type {
  BlockSchedule,
  DeviceOverrides,
  LineupSettings,
} from '../lineups/lineup-schema.js';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * 따로 부여하는 역할. SUBMITTER는 로그인한 모든 사용자가 기본으로 가지므로
 * 저장하지 않는다(src/auth/types/role.ts 참고).
 * SUPER_ADMIN이 PUT/DELETE /signage/users/:id/roles/:role로 부여·회수한다.
 * 첫 SUPER_ADMIN만 DB에 직접 INSERT 한다.
 */
export const grantedRoleEnum = pgEnum('granted_role', [
  'REVIEWER',
  'SUPER_ADMIN',
]);

/** Infoteam IdP로 로그인한 사용자. 첫 로그인 때 생성되고 로그인마다 갱신된다. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // IdP의 sub. 사용자를 식별하는 기준 값이다.
  idpUuid: varchar('idp_uuid', { length: 255 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  studentId: varchar('student_id', { length: 32 }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: grantedRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

/**
 * 관리 화면 없이 DB에 직접 넣는 참조 데이터(카테고리·대상 그룹)는
 * 사람이 읽을 수 있는 slug를 ID로 쓴다. 예: performance, grp_house_a
 */
const SLUG_PATTERN = '^[a-z][a-z0-9_]{0,63}$';

/** 게시물 분류. 신청 폼의 선택지이자 TV에 표시되는 분류명이다. */
export const categories = pgTable(
  'categories',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 50 }).notNull(),
    // 오름차순으로 노출한다.
    sortOrder: integer('sort_order').notNull().default(0),
    // 이미 쓰인 카테고리는 지우지 않고 숨긴다. 기존 신청은 그대로 이 카테고리를 가리킨다.
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'categories_id_format',
      sql`${table.id} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`,
    ),
  ],
);

/**
 * 게시 대상 위치 묶음(예: 학사기숙사 A동). 기기와 신청이 그룹을 가리킨다.
 * 운영자가 관리 화면에서 만든다(src/target-groups). 그때 ID는 서버가 grp_xxx로 정한다.
 */
export const targetGroups = pgTable(
  'target_groups',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    // 목록을 이름순으로 주면서 쓰지 않는다.
    sortOrder: integer('sort_order').notNull().default(0),
    // false면 숨긴 그룹. 새로 고를 수 없지만 이미 연결된 기기·신청과 편성은 그대로다.
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'target_groups_id_format',
      sql`${table.id} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`,
    ),
    // 대소문자만 다른 이름도 같은 그룹으로 본다. 숨긴 그룹도 센다.
    uniqueIndex('target_groups_name_lower_uq').on(sql`lower(${table.name})`),
  ],
);

export const assetStatusEnum = pgEnum('asset_status', [
  // 서명 URL을 발급했고 브라우저 업로드를 기다린다
  'PENDING_UPLOAD',
  // 검증과 변형 이미지 생성을 마쳤다. 신청에 쓸 수 있다
  'READY',
  // 형식·크기·해상도 검증에 실패했다. 원본은 지웠다
  'REJECTED',
  // 영상만. 업로드를 확인했고 변환 대기열에 있다 (src/assets/video-processing.service.ts)
  'PROCESSING',
]);

export const assetKindEnum = pgEnum('asset_kind', ['IMAGE', 'VIDEO']);

/**
 * 업로드한 포스터(이미지 또는 영상). 원본은 uploads/<id>(비공개)에 받아 검증한 뒤 지우고,
 * 메타데이터를 뺀 공개용 파일만 assets/<id>/ 아래(공개)에 남긴다.
 * - 이미지: <variant>.webp
 * - 영상: video.mp4와, 대표 프레임으로 만든 <variant>.webp
 * 내용이 바뀌지 않으므로 포스터를 바꾸려면 새 asset을 만든다.
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: assetStatusEnum('status').notNull().default('PENDING_UPLOAD'),
    // presign에서 신고한 형식으로 정한다. 서명 URL이 Content-Type을 고정하므로 바뀌지 않는다
    kind: assetKindEnum('kind').notNull().default('IMAGE'),

    // presign 요청에서 사용자가 알려 준 값. 서명 URL 조건과 완료 시 대조에 쓴다.
    fileName: varchar('file_name', { length: 255 }).notNull(),
    declaredMimeType: varchar('declared_mime_type', { length: 50 }).notNull(),
    declaredSizeBytes: integer('declared_size_bytes').notNull(),
    declaredChecksum: varchar('declared_checksum', { length: 71 }),
    uploadExpiresAt: timestamp('upload_expires_at', {
      withTimezone: true,
    }).notNull(),

    // 완료 처리에서 파일 내용으로 판별한 값 (READY일 때 채워진다)
    mimeType: varchar('mime_type', { length: 50 }),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes'),
    // sha256:<hex>. TV 미디어 캐시 key이자 승인 시 고정하는 값
    checksum: varchar('checksum', { length: 71 }),
    // 영상만 (READY일 때 채워진다)
    durationMs: integer('duration_ms'),
    hasAudio: boolean('has_audio'),
    // 영상 변환 작업. 가져갈 때 시작 시각을 적고 횟수를 올린다. 시작 시각이 오래됐으면 멈춘 것으로 보고 다시 가져간다
    processingAttempts: integer('processing_attempts').notNull().default(0),
    processingStartedAt: timestamp('processing_started_at', {
      withTimezone: true,
    }),
    // REJECTED일 때 사용자에게 보여 줄 사유
    rejectionReason: varchar('rejection_reason', { length: 255 }),
    processedAt: timestamp('processed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('assets_owner_id_idx').on(table.ownerId),
    // 신청되지 않은 채 남은 업로드를 정리할 때 쓴다 (Phase 8)
    index('assets_status_created_at_idx').on(table.status, table.createdAt),
  ],
);

export type Asset = typeof assets.$inferSelect;

/**
 * 게시 신청 상태 (요구사항 6.3의 10개 값). 전이 규칙은 src/submissions/submission-rules.ts.
 * APPROVED·SCHEDULED·PUBLISHED·ENDED는 시각에 따라 바뀌는데, 배치가 늦어도
 * 화면·편성이 어긋나지 않도록 판정은 항상 status와 기간을 함께 본다.
 */
export const submissionStatusEnum = pgEnum('submission_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'ENDED',
  'SUSPENDED',
  'CANCELED',
  'ARCHIVED',
]);

export type SubmissionStatus = (typeof submissionStatusEnum.enumValues)[number];

/**
 * 심사받는 컨텐츠의 종류. 종류마다 다른 규칙은 src/submissions/kinds/의 정의 파일에 둔다.
 * 값은 그 종류의 정의가 생길 때 더한다.
 */
export const submissionTypeEnum = pgEnum('submission_type', [
  'POSTER',
  'EVENT_BANNER',
  'STORY',
]);

export type SubmissionType = (typeof submissionTypeEnum.enumValues)[number];

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: submissionTypeEnum('type').notNull().default('POSTER'),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id),
    // detailUrl이 Ziggle 공지 주소면 서버가 뽑아 넣는다. 공지 하나에 신청 하나를 보장하는 기준.
    ziggleNoticeId: varchar('ziggle_notice_id', { length: 64 }),
    title: varchar('title', { length: 200 }).notNull(),
    // 포스터만 쓴다
    categoryId: varchar('category_id', { length: 64 }).references(
      () => categories.id,
    ),
    // 신청의 주 미디어. 승인 때 checksum을 고정하고, 자산 정리 잡이 참조를 확인한다.
    // 포스터는 포스터, 이벤트 배너는 IMAGE 모드의 이미지나 TEMPLATE 모드의 사진(없으면 null).
    assetId: uuid('asset_id').references(() => assets.id),
    detailUrl: varchar('detail_url', { length: 2048 }),
    // 게시 기간. 신청자가 정하는 종류는 처음부터 있고, 승인 때 정하는 종류(제보)는 승인 전까지 null이다
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    status: submissionStatusEnum('status').notNull(),
    // 편성 우선순위. 운영자가 정한다(기본 0).
    priority: integer('priority').notNull().default(0),

    // 화면 표시용 자유 입력. 조직 모델 없이 주최를 신청마다 적는다.
    organizerName: varchar('organizer_name', { length: 100 }),
    subtitle: varchar('subtitle', { length: 100 }),
    location: varchar('location', { length: 100 }),
    description: varchar('description', { length: 1000 }),

    // 낙관적 잠금. 수정·상태 변경마다 1씩 오른다.
    version: integer('version').notNull().default(1),
    // 마지막으로 검토 대기에 들어간 시각. 검토 대기 시간과 대기 목록 정렬 기준.
    submittedAt: timestamp('submitted_at', { withTimezone: true }),

    // 목록 cursor가 밀리초 단위라 앱에서 넣는다(DB의 마이크로초와 섞이면 경계 항목이 빠진다).
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('submissions_requester_created_idx').on(
      table.requesterId,
      table.createdAt,
    ),
    index('submissions_status_submitted_idx').on(
      table.status,
      table.submittedAt,
    ),
    index('submissions_created_idx').on(table.createdAt),
    // 공지 하나에 신청 하나. 끝난 신청(취소·종료·보관)은 세지 않아 같은 공지로 다시 신청할 수 있다
    // (같은 행사를 다시 알리는 등). 세 상태는 다시 살아나지 않으므로 두 신청이 동시에 살아 있을 수 없다.
    uniqueIndex('submissions_ziggle_notice_id_active_uq')
      .on(table.ziggleNoticeId)
      .where(sql`${table.status} not in ('CANCELED', 'ENDED', 'ARCHIVED')`),
    check('submissions_period_order', sql`${table.endAt} > ${table.startAt}`),
    check(
      'submissions_period_both_or_neither',
      sql`(${table.startAt} is null) = (${table.endAt} is null)`,
    ),
    // 승인을 거친 신청은 기간이 있다. 기간이 비는 것은 승인 때 기간을 정하는 종류의 승인 전뿐이다.
    // (새 종류 값은 같은 트랜잭션의 CHECK에 쓸 수 없어 종류 대신 상태로 적는다. 마이그레이션은 한 트랜잭션에서 돈다)
    check(
      'submissions_period_after_approval',
      sql`${table.startAt} is not null or ${table.status} in ('DRAFT', 'PENDING_REVIEW', 'REJECTED', 'CANCELED', 'ARCHIVED')`,
    ),
    check(
      'submissions_poster_fields',
      sql`${table.type} <> 'POSTER' or (${table.categoryId} is not null and ${table.assetId} is not null)`,
    ),
    check(
      'submissions_category_poster_only',
      sql`${table.type} = 'POSTER' or ${table.categoryId} is null`,
    ),
  ],
);

export const eventBannerModeEnum = pgEnum('event_banner_mode', [
  'TEMPLATE',
  'IMAGE',
]);

export const eventBannerOccasionEnum = pgEnum('event_banner_occasion', [
  'BIRTHDAY',
  'ADMISSION',
  'GRADUATION',
  'AWARD',
  'WELCOME',
  'OTHER',
]);

export type EventBannerMode = (typeof eventBannerModeEnum.enumValues)[number];
export type EventBannerOccasion =
  (typeof eventBannerOccasionEnum.enumValues)[number];

/**
 * 이벤트 배너의 내용 (신청과 1:1). 이미지·사진은 submissions.asset_id에 있다.
 * TEMPLATE은 TV가 문구로 그리고, IMAGE는 올린 이미지를 그대로 띄운다.
 */
export const submissionEventBanners = pgTable(
  'submission_event_banners',
  {
    submissionId: uuid('submission_id')
      .primaryKey()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    mode: eventBannerModeEnum('mode').notNull(),
    occasion: eventBannerOccasionEnum('occasion'),
    recipient: varchar('recipient', { length: 20 }).notNull(),
    // TV에 크게 나오는 문구. 이 칸이 생기기 전 배너는 null이고 TV가 받는 사람을 대신 띄운다
    headline: varchar('headline', { length: 30 }),
    message: varchar('message', { length: 60 }),
    sender: varchar('sender', { length: 20 }),
    // 사진 속 인물의 동의를 받았다고 신청자가 확인했다. 사진이 있는 TEMPLATE에서만 true다
    photoConsent: boolean('photo_consent').notNull().default(false),
  },
  (table) => [
    check(
      'submission_event_banners_template_fields',
      sql`${table.mode} <> 'TEMPLATE' or (${table.occasion} is not null and ${table.message} is not null)`,
    ),
    check(
      'submission_event_banners_consent_template_only',
      sql`${table.mode} = 'TEMPLATE' or not ${table.photoConsent}`,
    ),
  ],
);

export type SubmissionEventBanner = typeof submissionEventBanners.$inferSelect;

export const storyTagEnum = pgEnum('story_tag', [
  'NEWS',
  'PRAISE',
  'LOST_FOUND',
  'SUGGESTION',
  'OTHER',
]);

export type StoryTag = (typeof storyTagEnum.enumValues)[number];

/** 제보 번호. 승인 때 하나씩 받는다. 롤백으로 번호가 비는 것은 괜찮다(사람이 보는 일련번호일 뿐) */
export const storyNumberSeq = pgSequence('story_number_seq');

/**
 * 소식 제보 (신청과 1:1). 작성자는 응답·편성·감사 로그에서 가린다(submissions.requester_id에만 있다).
 */
export const submissionStories = pgTable('submission_stories', {
  submissionId: uuid('submission_id')
    .primaryKey()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  tag: storyTagEnum('tag').notNull(),
  body: varchar('body', { length: 140 }).notNull(),
  // TV에 #128로 나오는 번호. 승인 때 정하고, 반려된 제보는 없다
  storyNumber: integer('story_number').unique(),
});

export type SubmissionStory = typeof submissionStories.$inferSelect;

/** 신청의 대상 위치 그룹. 없으면 전체 기기가 대상이다. */
export const submissionTargetGroups = pgTable(
  'submission_target_groups',
  {
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    targetGroupId: varchar('target_group_id', { length: 64 })
      .notNull()
      .references(() => targetGroups.id),
  },
  (table) => [
    primaryKey({ columns: [table.submissionId, table.targetGroupId] }),
  ],
);

export type Submission = typeof submissions.$inferSelect;

export const reviewDecisionEnum = pgEnum('review_decision', [
  'APPROVED',
  'REJECTED',
  // 게시 중단도 검토 이력에 남긴다. 신청자 상세에 중단 사유를 보여줘야 한다(FR-REV-05).
  'SUSPENDED',
]);

/** 반려 사유 (FR-REV-04). 값을 추가하면 프론트 라벨도 함께 바꿔야 한다. */
export const rejectReasonCodeEnum = pgEnum('reject_reason_code', [
  'LOW_RESOLUTION',
  'ASPECT_RATIO',
  'INFO_MISMATCH',
  'INAPPROPRIATE',
  'PERIOD',
  'DUPLICATE',
  // 소식 제보용. 종류마다 고를 수 있는 사유는 프론트가 거른다
  'PERSONAL_INFO',
  'DEFAMATION',
  'ADVERTISEMENT',
  'OTHER',
]);

export type ReviewDecision = (typeof reviewDecisionEnum.enumValues)[number];
export type RejectReasonCode = (typeof rejectReasonCodeEnum.enumValues)[number];

/** 검토 결정 이력. 한 번 쓰면 고치지 않는다. */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    // 검토자가 화면에서 보고 결정한 신청 version
    revision: integer('revision').notNull(),
    decision: reviewDecisionEnum('decision').notNull(),
    reasonCode: rejectReasonCodeEnum('reason_code'),
    // 반려 의견·중단 사유. 신청자에게 그대로 보인다.
    comment: varchar('comment', { length: 1000 }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    // 승인한 포스터의 checksum. 승인 이후 편성은 이 미디어를 기준으로 한다(FR-REV-03).
    assetChecksum: varchar('asset_checksum', { length: 71 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('reviews_submission_reviewed_idx').on(
      table.submissionId,
      table.reviewedAt,
    ),
  ],
);

export const deviceOrientationEnum = pgEnum('device_orientation', [
  'LANDSCAPE',
  'PORTRAIT',
]);

/**
 * 게시물을 띄우는 TV. 사용자 로그인 없이 관리자가 발급한 기기 토큰으로 접근한다.
 * 토큰 원문은 발급할 때 한 번만 보여 주고 DB에는 sha256만 둔다.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    location: varchar('location', { length: 200 }),
    orientation: deviceOrientationEnum('orientation')
      .notNull()
      .default('LANDSCAPE'),
    // 편성을 따르는 그룹. 기기 그룹(device_target_groups) 중 하나여야 한다(서비스가 검사한다).
    programGroupId: varchar('program_group_id', { length: 64 })
      .notNull()
      .references(() => targetGroups.id),
    // 그룹 편성 위에 덮어쓰는 기기 예외 (src/lineups/lineup-schema.ts)
    lineupOverrides: jsonb('lineup_overrides')
      .$type<DeviceOverrides>()
      .notNull()
      .default({ settings: {}, blocks: {} }),
    // 비활성 기기는 토큰이 있어도 접근할 수 없다.
    isActive: boolean('is_active').notNull().default(true),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    tokenIssuedAt: timestamp('token_issued_at', {
      withTimezone: true,
    }).notNull(),

    // heartbeat가 채운다. lastSeenAt은 기기 시계가 아니라 서버가 받은 시각이다.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    appVersion: varchar('app_version', { length: 32 }),
    resolutionWidth: integer('resolution_width'),
    resolutionHeight: integer('resolution_height'),
    // 기기가 지금 재생 중이라고 알린 편성 버전. 최신 편성과 다르면 동기화가 밀린 것이다.
    lastPlaylistVersion: varchar('last_playlist_version', { length: 64 }),
    // 기기가 마지막으로 포스터를 정상 렌더링한 시각(기기 시계 기준)
    lastRenderOkAt: timestamp('last_render_ok_at', { withTimezone: true }),
    // 마지막 heartbeat의 "지금 장면". 보내지 않는 옛 플레이어는 null
    nowPlaying: jsonb('now_playing').$type<NowPlaying>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('devices_program_group_idx').on(table.programGroupId)],
);

/** 기기가 속한 위치 그룹. 신청의 대상 그룹과 겹치면 그 기기에 편성된다. */
export const deviceTargetGroups = pgTable(
  'device_target_groups',
  {
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    targetGroupId: varchar('target_group_id', { length: 64 })
      .notNull()
      .references(() => targetGroups.id),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.targetGroupId] }),
    index('device_target_groups_group_idx').on(table.targetGroupId),
  ],
);

export type Device = typeof devices.$inferSelect;

/**
 * 운영 컨텐츠(D-day·운세·학식…). type은 src/programs/program-types.ts의 종류이고, params 모양은 그 종류가 정한다.
 * 편성 블록이 FK로 가리키므로 테이블을 먼저 둔다.
 */
export const programs = pgTable('programs', {
  id: varchar('id', { length: 64 }).primaryKey(),
  type: varchar('type', { length: 32 }).notNull(),
  name: varchar('name', { length: 40 }).notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export type Program = typeof programs.$inferSelect;

/** 그룹 편성. 그룹을 만들 때 같이 생기고 그룹과 같이 지워진다. */
export const groupLineups = pgTable('group_lineups', {
  groupId: varchar('group_id', { length: 64 })
    .primaryKey()
    .references(() => targetGroups.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  settings: jsonb('settings').$type<LineupSettings>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const lineupBlockSourceEnum = pgEnum('lineup_block_source', [
  'SUBMISSIONS',
  'PROGRAM',
]);

/**
 * 그룹 편성의 블록. 순서는 position이다.
 * 운영 컨텐츠를 가리키는 블록이 있으면 그 운영 컨텐츠는 지울 수 없다(RESTRICT).
 */
export const lineupBlocks = pgTable(
  'lineup_blocks',
  {
    groupId: varchar('group_id', { length: 64 })
      .notNull()
      .references(() => groupLineups.groupId, { onDelete: 'cascade' }),
    id: varchar('id', { length: 48 }).notNull(),
    position: integer('position').notNull(),
    source: lineupBlockSourceEnum('source').notNull(),
    submissionType: submissionTypeEnum('submission_type'),
    programId: varchar('program_id', { length: 64 }).references(
      () => programs.id,
      { onDelete: 'restrict' },
    ),
    durationSeconds: integer('duration_seconds').notNull(),
    perVisit: integer('per_visit'),
    schedule: jsonb('schedule').$type<BlockSchedule>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.id] }),
    uniqueIndex('lineup_blocks_group_position_uq').on(
      table.groupId,
      table.position,
    ),
    index('lineup_blocks_program_idx').on(table.programId),
    check(
      'lineup_blocks_source_fields',
      sql`case ${table.source}
        when 'SUBMISSIONS' then ${table.submissionType} is not null and ${table.perVisit} is not null and ${table.programId} is null
        when 'PROGRAM' then ${table.programId} is not null and ${table.submissionType} is null and ${table.perVisit} is null
      end`,
    ),
    check(
      'lineup_blocks_duration_range',
      sql`${table.durationSeconds} between 5 and 300`,
    ),
  ],
);

export type LineupBlock = typeof lineupBlocks.$inferSelect;

export const liveScopeEnum = pgEnum('live_scope', ['DEVICE', 'GROUP']);
export type LiveScope = (typeof liveScopeEnum.enumValues)[number];

/**
 * 라이브 상태(src/live/live-schema.ts). 범위(기기·그룹)마다 하나다. 기기 값이 그룹 값보다 우선한다.
 * until이 지난 것은 지우지 않고 읽을 때 뺀다. 범위가 둘이라 FK가 없다. 그룹을 지울 때 같이 지운다.
 */
export const liveStates = pgTable(
  'live_states',
  {
    scope: liveScopeEnum('scope').notNull(),
    scopeId: varchar('scope_id', { length: 64 }).notNull(),
    main: jsonb('main').$type<LiveMain>(),
    alert: jsonb('alert').$type<LiveAlert>(),
    setBy: uuid('set_by')
      .notNull()
      .references(() => users.id),
    setAt: timestamp('set_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.scopeId] })],
);

export type LiveState = typeof liveStates.$inferSelect;

/**
 * 노출이 보인 자리. WALL: 벽에 작게, SPOTLIGHT: 크게 보기, STRIP: 띠 가운데,
 * SCENE: 포스터 묶음 밖의 장면 한 장(이벤트 배너, 제보 카드)
 */
export const playPlacementEnum = pgEnum('play_placement', [
  'WALL',
  'SPOTLIGHT',
  'STRIP',
  'SCENE',
]);
export type PlayPlacement = (typeof playPlacementEnum.enumValues)[number];

/**
 * 노출 이벤트: 기기가 포스터를 정상 렌더링한 기록 (FR-DASH-03). 사람이 본 횟수가 아니다.
 * 재시작·재연결로 같은 batch가 다시 올 수 있어 (기기, eventId)로 중복을 막는다.
 * submissionId는 FK를 걸지 않는다. 삭제된 신청의 이벤트가 섞여도 batch 전체가 실패하지 않게 한다.
 */
export const playEvents = pgTable(
  'play_events',
  {
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    // 플레이어 프로세스 하나. 재시작으로 인한 과다 집계를 분석 단계에서 거를 때 쓴다.
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    submissionId: uuid('submission_id').notNull(),
    revision: integer('revision'),
    // 기기 시계 기준
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    completed: boolean('completed').notNull(),
    // 예전 플레이어는 보내지 않아 null이다.
    placement: playPlacementEnum('placement'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.eventId] }),
    index('play_events_submission_started_idx').on(
      table.submissionId,
      table.startedAt,
    ),
    // 기간별 재집계와 보관 기간 정리(started_at 기준)에 쓴다.
    index('play_events_started_idx').on(table.startedAt),
    // 집계 작업이 "지난 실행 이후 새로 들어온 이벤트"를 찾을 때 쓴다.
    index('play_events_received_idx').on(table.receivedAt),
  ],
);

/**
 * 노출 이벤트의 일별 집계 (서울 날짜, 게시물, 기기). 통계 API는 이 테이블을 읽는다.
 * 원본(play_events)은 보관 기간이 지나면 지우지만 집계는 남는다.
 * 기기·신청을 지워도 과거 통계가 남도록 FK를 걸지 않는다.
 */
export const playEventDaily = pgTable(
  'play_event_daily',
  {
    // 기기 시계로 렌더링을 시작한 시각의 서울 날짜
    day: date('day', { mode: 'string' }).notNull(),
    submissionId: uuid('submission_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    // 벽(WALL)을 뺀 노출. 크게 보기·띠 가운데·자리를 모르는 예전 이벤트를 센다.
    impressions: integer('impressions').notNull(),
    completedImpressions: integer('completed_impressions').notNull(),
    totalDurationMs: bigint('total_duration_ms', { mode: 'number' }).notNull(),
    // 벽에 작게 보인 노출. 같은 게시물이 이어서 크게 한 번 더 나오므로 impressions와 따로 센다.
    wallImpressions: integer('wall_impressions').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.submissionId, table.deviceId] }),
    index('play_event_daily_submission_day_idx').on(
      table.submissionId,
      table.day,
    ),
  ],
);

/** 주기 작업이 어디까지 처리했는지 (예: 노출 집계가 마지막으로 본 수신 시각) */
export const jobWatermarks = pgTable('job_watermarks', {
  name: varchar('name', { length: 64 }).primaryKey(),
  value: timestamp('value', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const auditActorTypeEnum = pgEnum('audit_actor_type', [
  'USER',
  'DEVICE',
  'SYSTEM',
]);

/**
 * 누가 무엇을 바꿨는지 (FR-AUD-01). 조회 API는 후속 Phase에서 만든다.
 * 대상 행을 지워도 기록은 남도록 FK를 걸지 않는다.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: auditActorTypeEnum('actor_type').notNull(),
    actorId: varchar('actor_id', { length: 64 }),
    // 예: SUBMISSION_APPROVED. 값 목록은 src/audit/audit.service.ts
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }).notNull(),
    targetId: varchar('target_id', { length: 64 }).notNull(),
    reason: varchar('reason', { length: 1000 }),
    metadata: jsonb('metadata'),
    requestId: varchar('request_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('audit_logs_target_idx').on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    index('audit_logs_created_idx').on(table.createdAt),
  ],
);

/**
 * 지워야 하는 저장소 파일. DB 행 삭제와 같은 트랜잭션에서 기록하고, 파일 삭제에 성공해야 뺀다.
 * 삭제가 실패해도 키가 남아 있어 정리 작업(src/jobs/asset-cleanup.job.ts)이 다시 시도한다.
 */
export const storageDeletions = pgTable('storage_deletions', {
  key: varchar('key', { length: 1024 }).primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  lastError: varchar('last_error', { length: 500 }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const idempotencyStatusEnum = pgEnum('idempotency_status', [
  'IN_PROGRESS',
  'COMPLETED',
]);

/**
 * Idempotency-Key로 받은 요청의 처리 상태와 성공 응답.
 * 같은 key의 재시도에는 저장된 응답을 그대로 돌려준다(src/common/idempotency).
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    // key를 보낸 주체. 'user:<users.id>' 형식이라 다른 사용자의 응답을 받을 수 없다.
    scope: varchar('scope', { length: 64 }).notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    // method + path + body의 sha256. 같은 key로 다른 요청을 보내면 거절한다.
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    status: idempotencyStatusEnum('status').notNull(),
    responseBody: jsonb('response_body'),
    // 처리 중인 요청이 이 시각까지 끝나지 않으면 죽은 것으로 보고 다른 요청이 넘겨받는다.
    lockedUntil: timestamp('locked_until', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key] }),
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
  ],
);

export type User = typeof users.$inferSelect;
export type GrantedRole = (typeof grantedRoleEnum.enumValues)[number];
