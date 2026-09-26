import type { Database, Transaction } from '../db/index.js';
import { storageDeletions } from '../db/schema.js';

/**
 * 지울 파일을 기록한다. 행 삭제와 같은 트랜잭션에서 부르면, 행은 지워졌는데 파일 키를 잃는 일이 없다.
 * 실제 삭제와 재시도는 업로드 정리 작업이 한다. 이미 기록된 키는 그대로 둔다.
 */
export async function enqueueStorageDeletions(
  executor: Database | Transaction,
  keys: string[],
  at: Date,
): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  await executor
    .insert(storageDeletions)
    .values(keys.map((key) => ({ key, createdAt: at })))
    .onConflictDoNothing({ target: storageDeletions.key });
}
