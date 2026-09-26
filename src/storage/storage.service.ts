/**
 * 객체 저장소 경계. 실제 구현은 S3StorageService이고,
 * e2e 테스트는 메모리 구현으로 바꿔 끼운다.
 *
 * 키 규칙
 * - uploads/<assetId>: 브라우저가 올린 원본. 비공개이고 처리 후 지운다(EXIF 위치 정보 포함 가능)
 * - assets/<assetId>/<variant>.webp: 처리한 공개 이미지. 버킷 정책으로 이 경로만 공개 읽기를 연다
 */
export abstract class StorageService {
  /** 브라우저가 직접 PUT할 서명 URL. 서명한 Content-Type·Content-Length와 다르면 저장소가 거절한다. */
  abstract presignPut(
    key: string,
    options: {
      contentType: string;
      contentLength: number;
      expiresInSeconds: number;
    },
  ): Promise<string>;

  /** 객체 크기. 없으면 null */
  abstract sizeOf(key: string): Promise<number | null>;

  abstract getBytes(key: string): Promise<Buffer>;

  abstract put(
    key: string,
    body: Buffer,
    options: { contentType: string; cacheControl?: string },
  ): Promise<void>;

  /** 없는 키를 지워도 오류가 아니다. */
  abstract delete(key: string): Promise<void>;

  /** assets/ 아래 공개 객체의 URL */
  abstract publicUrl(key: string): string;
}
