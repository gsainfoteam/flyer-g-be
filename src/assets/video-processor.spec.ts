import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { MediaRejectedError } from './image-processor.js';
import {
  detectContainer,
  inspect,
  processVideo,
  sha256File,
} from './video-processor.js';

// 영상 처리에는 ffmpeg·ffprobe가 필요하다 (CI와 배포 이미지에는 설치되어 있다).
const exec = promisify(execFile);
const MAX = { maxDurationSeconds: 30 };

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'video-processor-spec-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

let seq = 0;
/** 테스트 영상을 만든다. 같은 테스트에서 여러 개 만들 수 있게 이름을 매번 새로 붙인다 */
async function video(
  ext: 'mp4' | 'mov' | 'webm',
  options: {
    size?: string;
    rate?: number;
    seconds?: number;
    audio?: boolean;
    args?: string[];
  } = {},
): Promise<string> {
  const { size = '320x180', rate = 30, seconds = 2, audio = true } = options;
  const path = join(dir, `in-${++seq}.${ext}`);
  const codec =
    ext === 'webm'
      ? ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-c:a', 'libopus']
      : ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
  // prettier-ignore
  await exec('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=${rate}`,
    ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440'] : []),
    '-t', String(seconds),
    ...codec,
    ...(options.args ?? []),
    path,
  ]);
  return path;
}

async function probeOutput(path: string) {
  // prettier-ignore
  const { stdout } = await exec('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
  ]);
  return JSON.parse(stdout) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      avg_frame_rate?: string;
      side_data_list?: unknown[];
    }[];
    format: { tags?: Record<string, string> };
  };
}

async function workDir() {
  return mkdtemp(join(dir, 'work-'));
}

async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MediaRejectedError);
    return (error as Error).message;
  }
  throw new Error('거절되지 않았다');
}

describe('processVideo', () => {
  it('MP4를 H.264·AAC mp4로 바꾸고 대표 프레임 이미지를 만든다', async () => {
    const result = await processVideo(
      await video('mp4', { size: '640x360' }),
      await workDir(),
      MAX,
    );

    expect(result).toMatchObject({
      mimeType: 'video/mp4',
      width: 640,
      height: 360,
      hasAudio: true,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(1900);
    expect(result.durationMs).toBeLessThanOrEqual(2100);

    const out = await probeOutput(result.videoPath);
    const v = out.streams.find((s) => s.codec_type === 'video')!;
    expect([v.codec_name, v.pix_fmt, v.width, v.height]).toEqual([
      'h264',
      'yuv420p',
      640,
      360,
    ]);
    expect(out.streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe(
      'aac',
    );

    const tv = await sharp(result.variants.tv).metadata();
    expect([tv.format, tv.width, tv.height]).toEqual(['webp', 640, 360]);
  });

  it('촬영 위치 등 메타데이터를 모두 지운다', async () => {
    const input = await video('mov', {
      args: ['-metadata', 'location=+35.2280+126.8430/'],
    });
    expect((await probeOutput(input)).format.tags?.location).toBeDefined();

    const result = await processVideo(input, await workDir(), MAX);
    const tags = (await probeOutput(result.videoPath)).format.tags ?? {};
    expect(Object.keys(tags).some((key) => key.includes('location'))).toBe(
      false,
    );
    const bytes = await readFile(result.videoPath);
    expect(bytes.includes(Buffer.from('+35.2280'))).toBe(false);
  });

  it('회전 정보를 적용한 크기로 판정하고 돌려서 저장한다', async () => {
    // 저장은 가로 320x180, "90도 돌려서 보라" → 실제 모양은 세로 180x320 (휴대폰 세로 촬영)
    const stored = await video('mov');
    const rotated = join(dir, 'rotated.mov');
    // prettier-ignore
    await exec('ffmpeg', [
      '-v', 'error', '-y', '-display_rotation', '90', '-i', stored,
      '-c', 'copy', rotated,
    ]);

    const result = await processVideo(rotated, await workDir(), MAX);
    expect(result.mimeType).toBe('video/quicktime');
    expect([result.width, result.height]).toEqual([180, 320]);

    const v = (await probeOutput(result.videoPath)).streams.find(
      (s) => s.codec_type === 'video',
    )!;
    expect([v.width, v.height]).toEqual([180, 320]);
    expect(v.side_data_list).toBeUndefined();
  });

  it('1920x1080 안으로 줄이고 30fps를 넘으면 30fps로 낮춘다', async () => {
    const result = await processVideo(
      await video('mp4', { size: '3840x2160', rate: 60, seconds: 0.5 }),
      await workDir(),
      MAX,
    );
    expect([result.width, result.height]).toEqual([3840, 2160]);

    const v = (await probeOutput(result.videoPath)).streams.find(
      (s) => s.codec_type === 'video',
    )!;
    expect([v.width, v.height, v.avg_frame_rate]).toEqual([1920, 1080, '30/1']);
  });

  it('WebM도 받고, 소리가 없으면 소리 트랙 없이 만든다', async () => {
    const result = await processVideo(
      await video('webm', { audio: false }),
      await workDir(),
      MAX,
    );
    expect(result).toMatchObject({ mimeType: 'video/webm', hasAudio: false });
    const out = await probeOutput(result.videoPath);
    expect(out.streams.map((s) => s.codec_type)).toEqual(['video']);
  });

  it('최대 길이를 넘으면 현재 길이와 함께 거절한다', async () => {
    const input = await video('mp4', {
      size: '64x36',
      rate: 5,
      seconds: 31,
      audio: false,
    });
    const message = await rejectionOf(
      processVideo(input, await workDir(), MAX),
    );
    expect(message).toBe('영상은 30초 이하여야 합니다. (현재 31.0초)');
  });

  it('영상이 아니면 거절한다 (JPEG를 mp4라고 올린 경우)', async () => {
    const path = join(dir, 'image.mp4');
    await writeFile(
      path,
      await sharp({
        create: { width: 64, height: 64, channels: 3, background: '#000' },
      })
        .jpeg()
        .toBuffer(),
    );
    const message = await rejectionOf(processVideo(path, await workDir(), MAX));
    expect(message).toContain('지원하지 않는 형식');
  });

  it('HLS 재생목록은 서버 파일을 읽지 않고 거절한다', async () => {
    const path = join(dir, 'playlist.mp4');
    await writeFile(
      path,
      '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10.0,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n',
    );
    const message = await rejectionOf(processVideo(path, await workDir(), MAX));
    expect(message).toContain('지원하지 않는 형식');
  });

  it('잘린 파일은 거절한다', async () => {
    const full = await readFile(await video('mp4'));
    const path = join(dir, 'truncated.mp4');
    await writeFile(path, full.subarray(0, 2000));
    await rejectionOf(processVideo(path, await workDir(), MAX));
  });
});

describe('detectContainer', () => {
  it('시그니처로 형식을 판별한다', async () => {
    expect((await detectContainer(await video('mp4')))?.mimeType).toBe(
      'video/mp4',
    );
    expect((await detectContainer(await video('mov')))?.mimeType).toBe(
      'video/quicktime',
    );
    const tiny = join(dir, 'tiny');
    await writeFile(tiny, 'abc');
    expect(await detectContainer(tiny)).toBeNull();
  });
});

describe('inspect', () => {
  const stream = {
    codec_type: 'video',
    codec_name: 'h264',
    width: 1920,
    height: 1080,
    avg_frame_rate: '30000/1001',
  };

  it('영상 트랙이 없으면 거절한다 (소리만 있거나 앨범 아트만 있는 파일)', () => {
    expect(() =>
      inspect(
        {
          streams: [
            { codec_type: 'audio', codec_name: 'aac' },
            {
              ...stream,
              codec_name: 'mjpeg',
              disposition: { attached_pic: 1 },
            },
          ],
          format: { duration: '3' },
        },
        MAX,
      ),
    ).toThrow('영상 트랙이 없습니다.');
  });

  it('허용하지 않는 코덱은 거절한다', () => {
    expect(() =>
      inspect(
        {
          streams: [{ ...stream, codec_name: 'gif' }],
          format: { duration: '3' },
        },
        MAX,
      ),
    ).toThrow('지원하지 않는 영상 코덱입니다. (gif)');
  });

  it('4K보다 크면 거절한다', () => {
    expect(() =>
      inspect(
        {
          streams: [{ ...stream, width: 7680, height: 4320 }],
          format: { duration: '3' },
        },
        MAX,
      ),
    ).toThrow('해상도가 너무 큽니다');
  });

  it('길이를 알 수 없으면 거절한다', () => {
    expect(() => inspect({ streams: [stream], format: {} }, MAX)).toThrow(
      '영상 길이를 알 수 없습니다',
    );
  });

  it('fps와 소리 트랙 여부를 읽는다', () => {
    expect(
      inspect(
        {
          streams: [stream, { codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '12.345' },
        },
        MAX,
      ),
    ).toEqual({
      width: 1920,
      height: 1080,
      durationMs: 12345,
      fps: 30000 / 1001,
      hasAudio: true,
    });
  });
});

describe('sha256File', () => {
  it('파일 내용의 sha256을 준다', async () => {
    const path = join(dir, 'hello.txt');
    await writeFile(path, 'hello');
    expect(await sha256File(path)).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
