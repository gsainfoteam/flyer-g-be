import {
  acceptedFormatsMessage,
  allowedMimeTypes,
  maxUploadBytesOf,
  mediaKindOf,
} from './signage-policy.js';

describe('signage-policy', () => {
  it('영상 업로드가 꺼져 있으면 이미지 형식만 받는다', () => {
    expect(allowedMimeTypes(false)).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(acceptedFormatsMessage(false)).toBe(
      'JPEG, PNG, WebP 파일만 올릴 수 있습니다.',
    );
  });

  it('켜져 있으면 영상 형식도 받는다', () => {
    expect(allowedMimeTypes(true)).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/webm',
    ]);
    expect(acceptedFormatsMessage(true)).toContain('MP4, MOV, WebM');
  });

  it('형식으로 종류와 최대 용량을 정한다', () => {
    expect(mediaKindOf('video/quicktime')).toBe('VIDEO');
    expect(mediaKindOf('image/png')).toBe('IMAGE');
    expect(maxUploadBytesOf('VIDEO')).toBe(100 * 1024 * 1024);
    expect(maxUploadBytesOf('IMAGE')).toBe(10 * 1024 * 1024);
  });
});
