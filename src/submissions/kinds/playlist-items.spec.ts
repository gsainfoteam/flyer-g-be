import type { EventBannerDetail } from './event-banner.kind.js';
import { EVENT_BANNER_KIND } from './event-banner.kind.js';
import { posterPlaylistItem } from './poster.kind.js';
import { STORY_KIND } from './story.kind.js';
import type { MediaUrls, PlaylistRow } from './submission-kind.js';

const ASSET_ID = '00000000-0000-4000-8000-000000000001';

const media: MediaUrls = {
  variantUrls: (id) => ({
    thumb: `https://cdn.test/${id}/thumb.webp`,
    preview: `https://cdn.test/${id}/preview.webp`,
    tv: `https://cdn.test/${id}/tv.webp`,
  }),
  videoUrl: ({ id, kind }) =>
    kind === 'VIDEO' ? `https://cdn.test/${id}/video.mp4` : null,
};

const asset = {
  id: ASSET_ID,
  kind: 'IMAGE' as const,
  width: 1080,
  height: 1080,
  durationMs: null,
  hasAudio: null,
  checksum: `sha256:${'a'.repeat(64)}`,
};

const row = (overrides: Partial<PlaylistRow> = {}): PlaylistRow => ({
  id: 'sub-1',
  type: 'EVENT_BANNER',
  version: 2,
  title: '생일 · 지민에게',
  detailUrl: null,
  priority: 0,
  subtitle: null,
  location: null,
  organizerName: null,
  startAt: new Date('2026-10-30T15:00:00.000Z'),
  endAt: new Date('2026-10-31T15:00:00.000Z'),
  categoryName: null,
  asset: null,
  ...overrides,
});

const template: EventBannerDetail = {
  mode: 'TEMPLATE',
  occasion: 'BIRTHDAY',
  recipient: '지민',
  headline: '지민아, 생일 축하해',
  message: '생일 축하해!',
  sender: '3층 친구들',
  photoConsent: true,
};

describe('EVENT_BANNER_KIND.toPlaylistItem', () => {
  it('TEMPLATE 사진은 photoUrl로, IMAGE는 assetUrl로 준다', () => {
    expect(
      EVENT_BANNER_KIND.toPlaylistItem(row({ asset }), template, media),
    ).toMatchObject({
      submissionId: 'sub-1',
      revision: 2,
      startsAt: '2026-10-30T15:00:00.000Z',
      endsAt: '2026-10-31T15:00:00.000Z',
      mode: 'TEMPLATE',
      photoUrl: `https://cdn.test/${ASSET_ID}/tv.webp`,
      assetUrl: null,
      width: 1080,
      height: 1080,
    });

    const image: EventBannerDetail = {
      ...template,
      mode: 'IMAGE',
      occasion: null,
      message: null,
      photoConsent: false,
    };
    expect(
      EVENT_BANNER_KIND.toPlaylistItem(row({ asset }), image, media),
    ).toMatchObject({
      photoUrl: null,
      assetUrl: `https://cdn.test/${ASSET_ID}/tv.webp`,
    });
  });

  it('checksum은 문구와 미디어로 정해진다', () => {
    const checksumOf = (detail: EventBannerDetail, r = row()) =>
      EVENT_BANNER_KIND.toPlaylistItem(r, detail, media).checksum;
    const base = checksumOf(template);

    expect(base).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(checksumOf(template, row({ version: 3 }))).toBe(base);
    expect(checksumOf({ ...template, message: '축하해!' })).not.toBe(base);
    expect(checksumOf(template, row({ asset }))).not.toBe(base);
    expect(
      checksumOf(
        template,
        row({ asset: { ...asset, checksum: `sha256:${'b'.repeat(64)}` } }),
      ),
    ).not.toBe(checksumOf(template, row({ asset })));
  });
});

describe('STORY_KIND.toPlaylistItem', () => {
  it('번호·태그·본문만 싣는다', () => {
    const item = STORY_KIND.toPlaylistItem(
      row({ type: 'STORY' }),
      {
        tag: 'PRAISE',
        body: '건조기가 고쳐졌어요. 감사합니다!',
        storyNumber: 128,
      },
      media,
    );
    expect(item).toEqual({
      submissionId: 'sub-1',
      revision: 2,
      startsAt: '2026-10-30T15:00:00.000Z',
      endsAt: '2026-10-31T15:00:00.000Z',
      checksum: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      storyNumber: 128,
      tag: 'PRAISE',
      body: '건조기가 고쳐졌어요. 감사합니다!',
    });
  });
});

describe('posterPlaylistItem', () => {
  it('영상은 대표 프레임과 재생 정보를 같이 준다', () => {
    const video = {
      ...asset,
      kind: 'VIDEO' as const,
      width: 1920,
      height: 1080,
      durationMs: 12_000,
      hasAudio: true,
    };
    const item = posterPlaylistItem(
      row({ type: 'POSTER', categoryName: '공연', asset: video }),
      media,
    );
    expect(item).toMatchObject({
      category: '공연',
      kind: 'VIDEO',
      assetUrl: `https://cdn.test/${ASSET_ID}/tv.webp`,
      video: { url: `https://cdn.test/${ASSET_ID}/video.mp4`, hasAudio: true },
      checksum: asset.checksum,
    });
  });
});
