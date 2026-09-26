import type { PlaylistItemDto } from './dto/playlist.dto.js';
import { playlistVersionOf } from './playlist.service.js';

const item = (overrides: Partial<PlaylistItemDto> = {}): PlaylistItemDto => ({
  submissionId: 'sub-1',
  revision: 3,
  title: '공연',
  category: '공연',
  assetUrl: 'https://cdn.test/assets/a/tv.webp',
  detailUrl: null,
  startsAt: '2026-07-30T00:00:00.000Z',
  endsAt: '2026-08-06T14:59:59.000Z',
  priority: 0,
  checksum: `sha256:${'a'.repeat(64)}`,
  subtitle: null,
  location: null,
  organizerName: null,
  ...overrides,
});

const base = {
  items: [item()],
  layout: { type: 'FOUR_GRID', rotationSeconds: 10 },
  refreshAfterSeconds: 60,
};

describe('playlistVersionOf', () => {
  it('같은 내용이면 같은 16자 hex', () => {
    const version = playlistVersionOf(base);
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(playlistVersionOf(structuredClone(base))).toBe(version);
  });

  it.each([
    ['항목 추가', { items: [item(), item({ submissionId: 'sub-2' })] }],
    ['항목 제거', { items: [] }],
    ['신청 수정(revision)', { items: [item({ revision: 4 })] }],
    [
      '포스터 교체(checksum)',
      { items: [item({ checksum: `sha256:${'b'.repeat(64)}` })] },
    ],
    ['레이아웃', { layout: { type: 'SINGLE', rotationSeconds: 10 } }],
    ['전환 간격', { layout: { type: 'FOUR_GRID', rotationSeconds: 20 } }],
    ['갱신 주기', { refreshAfterSeconds: 30 }],
  ])('%s이 바뀌면 버전이 바뀐다', (_, change) => {
    expect(playlistVersionOf({ ...base, ...change })).not.toBe(
      playlistVersionOf(base),
    );
  });
});
