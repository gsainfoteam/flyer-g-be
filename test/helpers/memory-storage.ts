import type { StorageService } from '../../src/storage/storage.service.js';

/** e2e용 저장소. 브라우저 업로드는 upload()로 흉내 낸다. */
export class MemoryStorage implements StorageService {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async presignPut(key: string): Promise<string> {
    return `memory://upload/${key}`;
  }

  /** 서명 URL로 PUT한 것처럼 원본을 넣는다 */
  upload(key: string, body: Buffer, contentType = 'image/jpeg'): void {
    this.objects.set(key, { body, contentType });
  }

  async sizeOf(key: string): Promise<number | null> {
    return this.objects.get(key)?.body.length ?? null;
  }

  async getBytes(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) {
      throw new Error(`No object ${key}`);
    }
    return object.body;
  }

  async put(
    key: string,
    body: Buffer,
    options: { contentType: string },
  ): Promise<void> {
    this.objects.set(key, { body, contentType: options.contentType });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  publicUrl(key: string): string {
    return `https://cdn.test/${key}`;
  }
}
