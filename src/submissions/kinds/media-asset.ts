import type { KindContext } from './submission-kind.js';

/** 신청에 붙일 수 없는 asset의 이유. 종류마다 이 값으로 안내 문구를 고른다 */
export type MediaProblem = 'MISSING' | 'UPLOADING' | 'PROCESSING' | 'VIDEO';

/** 본인이 올려 처리까지 끝난 asset인가. 영상은 allowVideo일 때만 받는다 */
export async function checkMediaAsset(
  ctx: KindContext,
  assetId: string,
  { allowVideo }: { allowVideo: boolean },
): Promise<MediaProblem | null> {
  const asset = await ctx.findOwnedAsset(assetId);
  switch (asset?.status) {
    case 'PENDING_UPLOAD':
      return 'UPLOADING';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'READY':
      return !allowVideo && asset.kind === 'VIDEO' ? 'VIDEO' : null;
    default:
      return 'MISSING';
  }
}
