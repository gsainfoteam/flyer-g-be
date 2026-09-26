import { Injectable } from '@nestjs/common';
import { currentRequestId } from '../common/request-id/request-id.js';
import type { Transaction } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

export type AuditAction =
  | 'SUBMISSION_CREATED'
  | 'SUBMISSION_UPDATED'
  | 'SUBMISSION_RESUBMITTED'
  | 'SUBMISSION_CANCELED'
  | 'SUBMISSION_APPROVED'
  | 'SUBMISSION_REJECTED'
  | 'SUBMISSION_SUSPENDED';

export type AuditEntry = {
  actor: { type: 'USER' | 'DEVICE' | 'SYSTEM'; id: string | null };
  action: AuditAction;
  target: { type: 'SUBMISSION'; id: string };
  reason?: string | null;
  metadata?: Record<string, unknown>;
  at: Date;
};

/**
 * 감사 로그 기록. 바뀐 내용과 같은 트랜잭션에서 쓴다.
 * 변경은 됐는데 기록이 없거나, 기록은 있는데 변경이 롤백되는 일이 없게 하기 위해서다.
 */
@Injectable()
export class AuditService {
  async record(tx: Transaction, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      actorType: entry.actor.type,
      actorId: entry.actor.id,
      action: entry.action,
      targetType: entry.target.type,
      targetId: entry.target.id,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? null,
      requestId: currentRequestId() ?? null,
      createdAt: entry.at,
    });
  }
}
