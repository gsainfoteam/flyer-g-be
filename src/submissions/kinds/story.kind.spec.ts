import { STORY_KIND } from './story.kind.js';
import { EMPTY_KIND_COLUMNS, type KindContext } from './submission-kind.js';

const ctx: KindContext = {
  findOwnedAsset: () => Promise.reject(new Error('not used')),
  isActiveCategory: () => Promise.reject(new Error('not used')),
};

describe('STORY_KIND', () => {
  it('기간은 승인 시각부터 2일', () => {
    expect(STORY_KIND.schedule.mode).toBe('ON_APPROVAL');
    if (STORY_KIND.schedule.mode !== 'ON_APPROVAL') return;
    const approvedAt = new Date('2026-10-31T03:00:00.000Z');
    expect(STORY_KIND.schedule.periodFrom(approvedAt)).toEqual({
      startAt: approvedAt,
      endAt: new Date('2026-11-02T03:00:00.000Z'),
    });
  });

  it('전체 기기에 나가고, 작성자를 가리고, 다시 낼 수 없다', () => {
    expect(STORY_KIND).toMatchObject({
      targetable: false,
      anonymous: true,
      resubmittable: false,
      dailyLimit: 5,
    });
  });

  it('목록 제목은 본문 앞 40자이고 줄바꿈은 공백 하나다', async () => {
    const body = `${'가'.repeat(30)}\n\n${'나'.repeat(30)}`;
    const result = await STORY_KIND.resolve(
      { story: { tag: 'NEWS', body } },
      null,
      ctx,
    );
    expect(result.columns).toEqual({
      ...EMPTY_KIND_COLUMNS,
      title: `${'가'.repeat(30)} ${'나'.repeat(9)}`,
    });
    expect(result.detail).toEqual({ tag: 'NEWS', body, storyNumber: null });
  });

  it('수정해도 번호는 그대로다', async () => {
    const current = {
      columns: { ...EMPTY_KIND_COLUMNS, title: '예전 제목' },
      detail: {
        tag: 'NEWS' as const,
        body: '예전 본문입니다.',
        storyNumber: 7,
      },
    };
    const result = await STORY_KIND.resolve(
      { story: { tag: 'PRAISE', body: '새로 쓴 본문입니다.' } },
      current,
      ctx,
    );
    expect(result.detail).toEqual({
      tag: 'PRAISE',
      body: '새로 쓴 본문입니다.',
      storyNumber: 7,
    });
    expect(STORY_KIND.details!.equals(current.detail, result.detail)).toBe(
      false,
    );
  });
});
