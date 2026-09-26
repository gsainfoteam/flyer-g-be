import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { StorageService } from './storage.service.js';

@Injectable()
export class S3StorageService
  extends StorageService
  implements OnModuleDestroy
{
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    const region = config.get('AWS_S3_REGION', { infer: true });
    this.bucket = config.get('AWS_S3_BUCKET', { infer: true });
    // 인포팀 다른 서비스(account-be)와 같은 virtual-hosted 형식. assets/ 아래는 버킷 정책으로 공개한다.
    this.publicBaseUrl = `https://${this.bucket}.s3.${region}.amazonaws.com`;
    this.client = new S3Client({
      region,
      credentials: {
        accessKeyId: config.get('AWS_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY', { infer: true }),
      },
      // 기본 설정이면 SDK가 빈 본문 기준 체크섬을 서명 URL에 넣어, 브라우저가 올린 파일과
      // 맞지 않아 업로드가 거절된다. 필요할 때만 계산하게 한다.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  presignPut(
    key: string,
    options: {
      contentType: string;
      contentLength: number;
      expiresInSeconds: number;
    },
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: options.contentType,
        ContentLength: options.contentLength,
      }),
      {
        expiresIn: options.expiresInSeconds,
        // 기본은 이 헤더들을 서명하지 않는다. 서명해야 신청한 크기·형식과 다른 업로드를 저장소가 막는다.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
  }

  async sizeOf(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return head.ContentLength ?? 0;
    } catch (error) {
      // icarus-infra의 image-s3 모듈은 s3:ListBucket을 주지 않는다.
      // 그 권한이 없으면 S3는 없는 키 조회에 404 대신 403을 준다.
      if (error instanceof NotFound || statusOf(error) === 403) {
        return null;
      }
      throw error;
    }
  }

  async getBytes(key: string): Promise<Buffer> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!object.Body) {
      throw new Error(`Empty body for ${key}`);
    }
    return Buffer.from(await object.Body.transformToByteArray());
  }

  async put(
    key: string,
    body: Buffer,
    options: { contentType: string; cacheControl?: string },
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        CacheControl: options.cacheControl,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
}
