import type { Asset } from '../../db/schema.js';
import type { EventBannerInputDto } from '../dto/event-banner.dto.js';
import {
  EVENT_BANNER_KIND,
  type EventBannerDetail,
} from './event-banner.kind.js';
import {
  EMPTY_KIND_COLUMNS,
  type CurrentContent,
  type KindContext,
} from './submission-kind.js';

const kst = (iso: string) => new Date(`${iso}+09:00`);
const NOW = kst('2026-10-31T10:00:00');

const IMAGE_ID = '00000000-0000-4000-8000-000000000001';
const VIDEO_ID = '00000000-0000-4000-8000-000000000002';
const UPLOADING_ID = '00000000-0000-4000-8000-000000000003';

function ctx(): KindContext & { lookups: string[] } {
  const assets: Record<string, Partial<Asset>> = {
    [IMAGE_ID]: { status: 'READY', kind: 'IMAGE' },
    [VIDEO_ID]: { status: 'READY', kind: 'VIDEO' },
    [UPLOADING_ID]: { status: 'PENDING_UPLOAD', kind: 'IMAGE' },
  };
  const lookups: string[] = [];
  return {
    lookups,
    findOwnedAsset: (id) => {
      lookups.push(id);
      return Promise.resolve((assets[id] as Asset | undefined) ?? null);
    },
    isActiveCategory: () => Promise.resolve(true),
  };
}

const template = (
  overrides: Partial<EventBannerInputDto> = {},
): EventBannerInputDto => ({
  mode: 'TEMPLATE',
  occasion: 'BIRTHDAY',
  recipient: '지민',
  message: '생일 축하해!',
  sender: '3층 친구들',
  ...overrides,
});

const resolve = (
  eventBanner: EventBannerInputDto | undefined,
  current: CurrentContent<EventBannerDetail> | null = null,
  context = ctx(),
) => EVENT_BANNER_KIND.resolve({ eventBanner }, current, context);

describe('EVENT_BANNER_KIND.validateSchedule', () => {
  it('서울 자정부터 자정까지 1~3일', () => {
    const start = kst('2026-11-01T00:00:00');
    expect(
      EVENT_BANNER_KIND.validateSchedule(
        start,
        kst('2026-11-02T00:00:00'),
        NOW,
      ),
    ).toEqual({});
    expect(
      EVENT_BANNER_KIND.validateSchedule(
        start,
        kst('2026-11-04T00:00:00'),
        NOW,
      ),
    ).toEqual({});
    expect(
      EVENT_BANNER_KIND.validateSchedule(
        start,
        kst('2026-11-05T00:00:00'),
        NOW,
      ),
    ).toEqual({ endAt: '이벤트 배너는 최대 3일까지 걸 수 있습니다.' });
  });

  it('오늘 자정에 시작하는 당일 신청을 받는다', () => {
    expect(
      EVENT_BANNER_KIND.validateSchedule(
        kst('2026-10-31T00:00:00'),
        kst('2026-11-01T00:00:00'),
        NOW,
      ),
    ).toEqual({});
  });

  it('자정이 아닌 시각은 오류', () => {
    expect(
      EVENT_BANNER_KIND.validateSchedule(
        kst('2026-11-01T09:00:00'),
        kst('2026-11-02T09:00:00'),
        NOW,
      ),
    ).toEqual({
      startAt: '시작은 서울 기준 자정(00:00)이어야 합니다.',
      endAt: '종료는 서울 기준 자정(00:00)이어야 합니다.',
    });
  });

  it('공통 기간 규칙이 먼저다', () => {
    expect(
      EVENT_BANNER_KIND.validateSchedule(
        kst('2026-10-29T00:00:00'),
        kst('2026-10-30T00:00:00'),
        NOW,
      ),
    ).toEqual({ endAt: '종료 시각이 이미 지났습니다.' });
  });
});

describe('EVENT_BANNER_KIND.resolve', () => {
  it('TEMPLATE: 제목을 만들고 사진이 없으면 미디어도 없다', async () => {
    const result = await resolve(template());
    expect(result.errors).toEqual({});
    expect(result.columns).toEqual({
      ...EMPTY_KIND_COLUMNS,
      title: '생일 · 지민에게',
    });
    expect(result.detail).toEqual({
      mode: 'TEMPLATE',
      occasion: 'BIRTHDAY',
      recipient: '지민',
      message: '생일 축하해!',
      sender: '3층 친구들',
      photoConsent: false,
    });
  });

  it('TEMPLATE: occasion·message가 없으면 오류, assetId는 쓸 수 없다', async () => {
    const result = await resolve(
      template({ occasion: null, message: null, assetId: IMAGE_ID }),
    );
    expect(result.errors).toEqual({
      'eventBanner.occasion': '어떤 소식인지 고르세요.',
      'eventBanner.message': '전할 말을 입력하세요.',
      'eventBanner.assetId':
        '템플릿 배너에는 이미지를 쓸 수 없습니다. 사진은 photoAssetId로 넣으세요.',
    });
  });

  it('TEMPLATE: 사진은 동의가 있어야 하고 submissions.asset_id에 들어간다', async () => {
    const noConsent = await resolve(template({ photoAssetId: IMAGE_ID }));
    expect(noConsent.errors).toEqual({
      'eventBanner.photoConsent':
        '사진 속 사람의 동의를 받았는지 확인해 주세요.',
    });

    const ok = await resolve(
      template({ photoAssetId: IMAGE_ID, photoConsent: true }),
    );
    expect(ok.errors).toEqual({});
    expect(ok.columns.assetId).toBe(IMAGE_ID);
    expect(ok.detail.photoConsent).toBe(true);
  });

  it('IMAGE: 이미지가 필수이고 사진은 쓸 수 없다', async () => {
    const result = await resolve({
      mode: 'IMAGE',
      recipient: '지민',
      photoAssetId: IMAGE_ID,
      photoConsent: true,
    });
    expect(result.errors).toEqual({
      'eventBanner.assetId': '배너 이미지를 올려주세요.',
      'eventBanner.photoAssetId':
        '이미지 배너에는 사진을 따로 넣을 수 없습니다.',
    });
  });

  it('IMAGE: occasion이 없으면 "이벤트 배너"로 제목을 만들고 동의는 저장하지 않는다', async () => {
    const result = await resolve({
      mode: 'IMAGE',
      recipient: '지민',
      assetId: IMAGE_ID,
      photoConsent: true,
    });
    expect(result.errors).toEqual({});
    expect(result.columns).toMatchObject({
      title: '이벤트 배너 · 지민에게',
      assetId: IMAGE_ID,
    });
    expect(result.detail).toMatchObject({
      occasion: null,
      photoConsent: false,
    });
  });

  it('영상이나 업로드가 끝나지 않은 asset은 쓸 수 없다', async () => {
    const video = await resolve({
      mode: 'IMAGE',
      recipient: '지민',
      assetId: VIDEO_ID,
    });
    expect(video.errors).toEqual({
      'eventBanner.assetId': '영상은 쓸 수 없습니다. 이미지를 올려주세요.',
    });

    const uploading = await resolve(
      template({ photoAssetId: UPLOADING_ID, photoConsent: true }),
    );
    expect(uploading.errors).toEqual({
      'eventBanner.photoAssetId': '사진 업로드가 끝나지 않았습니다.',
    });
  });

  it('수정에서 내용을 보내지 않으면 지금 값을 그대로 쓴다', async () => {
    const { columns, detail } = await resolve(template());
    const context = ctx();
    const result = await resolve(undefined, { columns, detail }, context);
    expect(result).toEqual({ errors: {}, columns, detail });
    expect(context.lookups).toEqual([]);
  });

  it('수정에서 이미 연결된 asset은 다시 확인하지 않는다', async () => {
    const current = await resolve({
      mode: 'IMAGE',
      recipient: '지민',
      assetId: IMAGE_ID,
    });
    const context = ctx();
    await resolve(
      { mode: 'IMAGE', recipient: '수민', assetId: IMAGE_ID },
      { columns: current.columns, detail: current.detail },
      context,
    );
    expect(context.lookups).toEqual([]);
  });
});

describe('EVENT_BANNER_KIND.details.equals', () => {
  it('필드가 모두 같아야 같다', async () => {
    const { detail } = await resolve(template());
    expect(EVENT_BANNER_KIND.details!.equals(detail, { ...detail })).toBe(true);
    expect(
      EVENT_BANNER_KIND.details!.equals(detail, { ...detail, sender: null }),
    ).toBe(false);
  });
});
