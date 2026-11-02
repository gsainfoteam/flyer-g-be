import { eq, inArray, sql } from 'drizzle-orm';
import {
  storyNumberSeq,
  submissionStories,
  type SubmissionStory,
} from '../../db/schema.js';
import { SIGNAGE_POLICY } from '../../policy/signage-policy.js';
import {
  contentChecksum,
  EMPTY_KIND_COLUMNS,
  EMPTY_KIND_RESPONSE,
  playlistEntry,
  type SubmissionKind,
} from './submission-kind.js';

export type StoryDetail = Omit<SubmissionStory, 'submissionId'>;

const DAY_MS = 86_400_000;
const TITLE_LENGTH = 40;

/**
 * 소식 제보(대나무숲). 모든 TV에 나가고, 승인하는 순간부터 storyDisplayDays일 동안 게시된다.
 * 작성자는 본인에게만 보인다. 반려되면 고쳐 내지 않고 새로 쓴다.
 */
export const STORY_KIND: SubmissionKind<StoryDetail> = {
  type: 'STORY',

  inputFields: ['story'],

  schedule: {
    mode: 'ON_APPROVAL',
    periodFrom(approvedAt) {
      return {
        startAt: approvedAt,
        endAt: new Date(
          approvedAt.getTime() + SIGNAGE_POLICY.storyDisplayDays * DAY_MS,
        ),
      };
    },
  },

  targetable: false,
  dailyLimit: 5,
  resubmittable: false,
  anonymous: true,

  resolve(input, current) {
    const story = input.story;
    if (!story) {
      // 수정에서 내용을 보내지 않았으면 그대로 둔다. 생성은 DTO가 필수로 확인했다
      return Promise.resolve(
        current
          ? { errors: {}, ...current }
          : {
              errors: { story: '제보 내용을 입력하세요.' },
              columns: EMPTY_KIND_COLUMNS,
              detail: { tag: 'OTHER', body: '', storyNumber: null },
            },
      );
    }
    return Promise.resolve({
      errors: {},
      columns: { ...EMPTY_KIND_COLUMNS, title: titleOf(story.body) },
      detail: {
        tag: story.tag,
        body: story.body,
        storyNumber: current?.detail.storyNumber ?? null,
      },
    });
  },

  details: {
    async load(db, ids) {
      const rows =
        ids.length === 0
          ? []
          : await db
              .select()
              .from(submissionStories)
              .where(inArray(submissionStories.submissionId, ids));
      return new Map(
        rows.map(({ submissionId, ...detail }) => [submissionId, detail]),
      );
    },

    async save(tx, submissionId, { tag, body }) {
      // 번호는 승인 때만 정한다(onApprove)
      await tx
        .insert(submissionStories)
        .values({ submissionId, tag, body })
        .onConflictDoUpdate({
          target: submissionStories.submissionId,
          set: { tag, body },
        });
    },

    equals(a, b) {
      return a.tag === b.tag && a.body === b.body;
    },
  },

  async onApprove(tx, submissionId) {
    await tx
      .update(submissionStories)
      .set({ storyNumber: sql.raw(`nextval('${storyNumberSeq.seqName}')`) })
      .where(eq(submissionStories.submissionId, submissionId));
  },

  toResponse(_row, detail) {
    return { ...EMPTY_KIND_RESPONSE, story: detail };
  },

  toPlaylistItem(row, { tag, body, storyNumber }) {
    // 승인된 제보만 편성에 실리고, 승인 때 번호를 받는다
    const content = { storyNumber: storyNumber!, tag, body };
    return { ...playlistEntry(row, contentChecksum(content)), ...content };
  },
};

/** 목록용 제목: 본문 앞 40자. 줄바꿈은 공백 하나로 */
function titleOf(body: string): string {
  return [...body.replace(/\s+/g, ' ')].slice(0, TITLE_LENGTH).join('');
}
