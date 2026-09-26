import sharp from 'sharp';
import {
  ImageRejectedError,
  processImage,
  sha256Checksum,
} from './image-processor.js';

const MIN = { minShortEdgePx: 1080 };

function image(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' | 'gif' = 'jpeg',
) {
  return sharp({
    create: { width, height, channels: 3, background: '#3366cc' },
  })
    .toFormat(format)
    .toBuffer();
}

/** GPS 위치와 회전 정보가 든 JPEG */
async function jpegWithGps(width: number, height: number, orientation = 1) {
  return sharp(await image(width, height))
    .withMetadata({
      orientation,
      exif: {
        IFD0: { Make: 'TestCam' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 13/1 30/1' },
      },
    })
    .jpeg()
    .toBuffer();
}

async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImageRejectedError);
    return (error as Error).message;
  }
  throw new Error('rejected가 아니다');
}

describe('processImage', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    '%s는 형식·크기·checksum을 판별한다',
    async (format) => {
      const bytes = await image(1536, 2048, format);
      const result = await processImage(bytes, MIN);

      expect(result.mimeType).toBe(`image/${format}`);
      expect(result).toMatchObject({ width: 1536, height: 2048 });
      expect(result.checksum).toBe(sha256Checksum(bytes));
      expect(result.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    },
  );

  it('변형 이미지는 webp이고 상자 안에 맞춘다', async () => {
    const { variants } = await processImage(await image(1536, 2048), MIN);

    const sizes = await Promise.all(
      Object.entries(variants).map(async ([name, buffer]) => {
        const meta = await sharp(buffer).metadata();
        return [name, meta.format, meta.width, meta.height];
      }),
    );
    expect(sizes).toEqual([
      ['thumb', 'webp', 300, 400],
      ['preview', 'webp', 960, 1280],
      ['tv', 'webp', 810, 1080],
    ]);
  });

  it('원본보다 키우지 않는다', async () => {
    const { variants } = await processImage(await image(1080, 1080), MIN);
    const tv = await sharp(variants.tv).metadata();
    expect([tv.width, tv.height]).toEqual([1080, 1080]);
  });

  it('EXIF(GPS 포함)를 모두 지운다', async () => {
    const bytes = await jpegWithGps(1200, 1600);
    expect((await sharp(bytes).metadata()).exif).toBeDefined();

    const { variants } = await processImage(bytes, MIN);
    for (const buffer of Object.values(variants)) {
      const meta = await sharp(buffer).metadata();
      expect(meta.exif).toBeUndefined();
      expect(buffer.includes(Buffer.from('TestCam'))).toBe(false);
    }
  });

  it('EXIF 회전을 적용한 크기로 판정하고 돌려서 저장한다', async () => {
    // 저장은 가로 1600x1200, EXIF는 "90도 돌려서 보라"(6) → 실제 모양은 세로 1200x1600
    const bytes = await jpegWithGps(1600, 1200, 6);
    const result = await processImage(bytes, MIN);

    expect([result.width, result.height]).toEqual([1200, 1600]);
    const tv = await sharp(result.variants.tv).metadata();
    expect([tv.width, tv.height]).toEqual([810, 1080]);
  });

  it('짧은 변이 기준보다 작으면 현재 크기와 함께 거절한다', async () => {
    const message = await rejectionOf(
      processImage(await image(800, 2000), MIN),
    );
    expect(message).toBe('짧은 변이 1080px 이상이어야 합니다. (현재 800px)');
  });

  it('허용하지 않는 형식(GIF)은 거절한다', async () => {
    const message = await rejectionOf(
      processImage(await image(1200, 1600, 'gif'), MIN),
    );
    expect(message).toContain('지원하지 않는 형식');
  });

  it('확장자만 바꾼 SVG는 내용으로 판별해 거절한다', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><script>alert(1)</script></svg>',
    );
    const message = await rejectionOf(processImage(svg, MIN));
    expect(message).toContain('지원하지 않는 형식');
  });

  it('이미지가 아닌 파일은 거절한다', async () => {
    const exe = Buffer.from('MZ\x90\x00 this is not an image');
    await rejectionOf(processImage(exe, MIN));
  });

  it('본문이 잘린 파일은 거절한다', async () => {
    const bytes = await image(1200, 1600);
    const message = await rejectionOf(
      processImage(bytes.subarray(0, 2000), MIN),
    );
    expect(message).toContain('손상');
  });
});
