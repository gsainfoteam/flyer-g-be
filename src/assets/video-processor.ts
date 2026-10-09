import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { VideoMimeType } from '../policy/signage-policy.js';
import {
  makeVariants,
  MediaRejectedError,
  VARIANTS,
  type VariantName,
} from './image-processor.js';

/** 재시도하면 될 수 있는 실패. 시간 초과, 프로세스가 죽음, ffmpeg가 없음 등 */
export class TransientVideoError extends Error {}

// 4K(4096x2160)까지. 그보다 크면 변환이 너무 오래 걸리고 TV에서 이득도 없다.
const MAX_INPUT_PIXELS = 4096 * 2160;
// 출력은 TV 변형 이미지와 같은 상자에 맞춘다.
const OUTPUT_BOX = VARIANTS.tv;
const MAX_OUTPUT_FPS = 30;
const PROBE_TIMEOUT_MS = 30 * 1000;
const TRANSCODE_TIMEOUT_MS = 5 * 60 * 1000;
// 대표 프레임 위치. 첫 프레임은 검은 화면인 경우가 많아 조금 뒤에서 뽑는다.
const POSTER_FRAME_SECONDS = 1;

const ACCEPTED_VIDEO_CODECS = new Set([
  'h264',
  'hevc',
  'vp8',
  'vp9',
  'av1',
  'mpeg4',
  'prores',
]);

const UNSUPPORTED_FORMAT =
  '지원하지 않는 형식입니다. MP4, MOV, WebM 영상만 올릴 수 있습니다.';

export type ProcessedVideo = {
  /** 파일 내용으로 판별한 컨테이너 형식. 확장자·신고한 MIME은 믿지 않는다 */
  mimeType: VideoMimeType;
  /** 회전 메타데이터를 적용한 뒤의 원본 크기 */
  width: number;
  height: number;
  durationMs: number;
  hasAudio: boolean;
  /** 변환한 mp4 경로 (workDir 안). H.264·AAC, 메타데이터를 모두 뺐다 */
  videoPath: string;
  /** 대표 프레임으로 만든 webp */
  variants: Record<VariantName, Buffer>;
};

type Container = { mimeType: VideoMimeType; demuxer: 'mov' | 'matroska' };

/**
 * 업로드된 영상을 검증하고 TV용 mp4와 대표 프레임 이미지를 만든다.
 *
 * ffmpeg가 신뢰할 수 없는 파일을 파싱하므로 공격 면을 줄인다.
 * - 컨테이너를 시그니처로 먼저 판별하고 demuxer를 고정한다(-f). HLS·concat 재생목록처럼
 *   서버의 다른 파일을 읽어 들이는 형식은 고를 수 없다
 * - 프로토콜은 file만 허용한다. mov의 외부 참조(dref)는 ffmpeg 기본값으로 꺼져 있다
 * - 시간 제한을 넘기면 프로세스를 죽인다
 */
export async function processVideo(
  inputPath: string,
  workDir: string,
  options: { maxDurationSeconds: number },
): Promise<ProcessedVideo> {
  const container = await detectContainer(inputPath);
  if (!container) {
    throw new MediaRejectedError(UNSUPPORTED_FORMAT);
  }
  const probed = await probe(inputPath, container);

  const videoPath = join(workDir, 'video.mp4');
  await transcode(inputPath, container, probed, videoPath);

  const posterPath = join(workDir, 'poster.png');
  await extractPosterFrame(
    videoPath,
    Math.min(POSTER_FRAME_SECONDS, probed.durationMs / 2000),
    posterPath,
  );
  const poster = await readFile(posterPath);
  const variants = await makeVariants(
    () => sharp(poster),
    '영상이 손상되어 변환할 수 없습니다. 파일을 확인하고 다시 올려주세요.',
  );

  return {
    mimeType: container.mimeType,
    width: probed.width,
    height: probed.height,
    durationMs: probed.durationMs,
    hasAudio: probed.hasAudio,
    videoPath,
    variants,
  };

  async function probe(path: string, c: Container) {
    let output: string;
    try {
      // prettier-ignore
      output = await run('ffprobe', [
        '-v', 'error', '-protocol_whitelist', 'file', '-f', c.demuxer,
        '-show_streams', '-show_format', '-of', 'json', path,
      ], PROBE_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof ExitError) {
        throw new MediaRejectedError(
          '영상을 읽을 수 없습니다. 파일을 확인하고 다시 올려주세요.',
        );
      }
      throw error;
    }
    return inspect(JSON.parse(output) as ProbeResult, options);
  }
}

/** 파일 내용의 sha256. 영상은 메모리에 올리지 않고 읽는다 */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return `sha256:${hash.digest('hex')}`;
}

/** 시그니처로 컨테이너를 판별한다. MP4·MOV는 ftyp 상자, WebM은 EBML 헤더 */
export async function detectContainer(path: string): Promise<Container | null> {
  const file = await open(path, 'r');
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await file.read(head, 0, 12, 0);
    if (bytesRead < 12) {
      return null;
    }
    if (head.readUInt32BE(0) === 0x1a45dfa3) {
      return { mimeType: 'video/webm', demuxer: 'matroska' };
    }
    const box = head.toString('latin1', 4, 8);
    if (box === 'ftyp') {
      const brand = head.toString('latin1', 8, 12);
      return {
        mimeType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4',
        demuxer: 'mov',
      };
    }
    // ftyp 없이 시작하는 옛 QuickTime 파일
    if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(box)) {
      return { mimeType: 'video/quicktime', demuxer: 'mov' };
    }
    return null;
  } finally {
    await file.close();
  }
}

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
};

type ProbeResult = {
  streams?: ProbeStream[];
  format?: { duration?: string };
};

export type ProbedVideo = {
  width: number;
  height: number;
  durationMs: number;
  fps: number;
  hasAudio: boolean;
};

/** ffprobe 결과를 정책에 맞는지 본다. */
export function inspect(
  result: ProbeResult,
  options: { maxDurationSeconds: number },
): ProbedVideo {
  const streams = result.streams ?? [];
  // 앨범 아트처럼 영상 트랙에 붙은 정지 이미지는 영상으로 치지 않는다
  const video = streams.find(
    (s) => s.codec_type === 'video' && !s.disposition?.attached_pic,
  );
  if (!video || !video.width || !video.height) {
    throw new MediaRejectedError('영상 트랙이 없습니다.');
  }
  if (!ACCEPTED_VIDEO_CODECS.has(video.codec_name ?? '')) {
    throw new MediaRejectedError(
      `지원하지 않는 영상 코덱입니다. (${video.codec_name ?? '알 수 없음'})`,
    );
  }
  if (video.width * video.height > MAX_INPUT_PIXELS) {
    throw new MediaRejectedError(
      `해상도가 너무 큽니다. 4K(4096x2160) 이하로 올려주세요. (현재 ${video.width}x${video.height})`,
    );
  }

  const seconds = Number(result.format?.duration ?? video.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new MediaRejectedError(
      '영상 길이를 알 수 없습니다. 파일을 확인하고 다시 올려주세요.',
    );
  }
  if (seconds > options.maxDurationSeconds) {
    throw new MediaRejectedError(
      `영상은 ${options.maxDurationSeconds}초 이하여야 합니다. (현재 ${seconds.toFixed(1)}초)`,
    );
  }

  const rotation =
    video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
    Number(video.tags?.rotate ?? 0);
  const sideways = Math.abs(rotation) % 180 === 90;

  return {
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    durationMs: Math.round(seconds * 1000),
    fps: parseFrameRate(video.avg_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

function parseFrameRate(value: string | undefined): number {
  const [num, den] = (value ?? '').split('/').map(Number);
  return num > 0 && den > 0 ? num / den : 0;
}

async function transcode(
  inputPath: string,
  container: Container,
  probed: ProbedVideo,
  outputPath: string,
): Promise<void> {
  // 회전 메타데이터는 ffmpeg가 먼저 적용한다(autorotate). iw·ih는 돌린 뒤의 크기다. 원본보다 키우지 않는다.
  const filters = [
    `scale=w='min(${OUTPUT_BOX.width},iw)':h='min(${OUTPUT_BOX.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    ...(probed.fps > MAX_OUTPUT_FPS ? [`fps=${MAX_OUTPUT_FPS}`] : []),
    'format=yuv420p',
  ];
  try {
    // prettier-ignore
    await run('ffmpeg', [
      '-hide_banner', '-nostdin', '-v', 'error',
      '-protocol_whitelist', 'file', '-f', container.demuxer, '-i', inputPath,
      // 첫 영상 트랙과 (있으면) 첫 소리 트랙만. 자막·데이터·챕터·메타데이터(촬영 위치 포함)는 모두 뺀다
      '-map', '0:v:0', '-map', '0:a:0?',
      '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
      '-vf', filters.join(','),
      // TV 브라우저가 가장 널리 재생하는 조합. faststart로 받는 중에도 재생을 시작한다
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-maxrate', '6M', '-bufsize', '12M', '-profile:v', 'high',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-movflags', '+faststart', '-f', 'mp4', '-y', outputPath,
    ], TRANSCODE_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ExitError) {
      throw new MediaRejectedError(
        '영상이 손상되어 변환할 수 없습니다. 파일을 확인하고 다시 올려주세요.',
      );
    }
    throw error;
  }
}

async function extractPosterFrame(
  videoPath: string,
  atSeconds: number,
  outputPath: string,
): Promise<void> {
  // 이미 변환한(검증된) mp4에서 뽑는다
  // prettier-ignore
  await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-v', 'error',
    '-protocol_whitelist', 'file', '-f', 'mp4',
    '-ss', atSeconds.toFixed(3), '-i', videoPath,
    '-frames:v', '1', '-map_metadata', '-1', '-y', outputPath,
  ], PROBE_TIMEOUT_MS);
}

/** 파일 내용 때문에 ffmpeg가 실패했다(0이 아닌 종료 코드). 시그널·시간 초과는 TransientVideoError */
class ExitError extends Error {}

// 오류 메시지 진단용으로 stderr 끝부분만 남긴다
const STDERR_LIMIT = 2000;

function run(
  command: 'ffmpeg' | 'ffprobe',
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      // ENOENT: ffmpeg가 설치되어 있지 않다. 파일 탓이 아니므로 재시도 대상
      reject(
        new TransientVideoError(`${command} failed to start: ${error.message}`),
      );
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new TransientVideoError(`${command} timed out after ${timeoutMs}ms`),
        );
      } else if (signal) {
        reject(new TransientVideoError(`${command} killed by ${signal}`));
      } else if (code !== 0) {
        reject(
          new ExitError(`${command} exited with ${code}: ${stderr.trim()}`),
        );
      } else {
        resolve(Buffer.concat(stdout).toString());
      }
    });
  });
}
