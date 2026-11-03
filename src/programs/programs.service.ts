import { randomBytes } from 'node:crypto';
import { Trace } from '@gsainfoteam/nest-observability';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { validationFailed } from '../common/errors/validation.js';
import { openApiOf, parseOrFail } from '../common/validation/zod.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { programs, type Program } from '../db/schema.js';
import { SignageChanges } from '../realtime/signage-changes.js';
import type { ProgramDto, ProgramTypeDto } from './dto/program.dto.js';
import {
  isUsed,
  liveScopesUsing,
  programUsage,
  programUsageOf,
  type ProgramUsage,
} from './program-references.js';
import type {
  CreateProgramInput,
  UpdateProgramInput,
} from './program-schema.js';
import type { ProgramType } from './program-type.js';
import { dataStatusOf, PROGRAM_TYPES, programTypeOf } from './program-types.js';

/**
 * 운영 컨텐츠 (FE 요청 5-2). 종류마다 params 모양이 다르고, 종류 정의(program-types.ts)가 검증한다.
 * 가리키는 곳(편성 블록·정보줄)이 있으면 지우지 못한다(계획 1-5).
 */
@Trace()
@Injectable()
export class ProgramsService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
    private readonly signageChanges: SignageChanges,
  ) {}

  types(): ProgramTypeDto[] {
    return PROGRAM_TYPES.map(typeDtoOf);
  }

  async list(): Promise<ProgramDto[]> {
    const rows = await this.db
      .select()
      .from(programs)
      .orderBy(asc(programs.name), asc(programs.id));
    const usage = await programUsageOf(
      this.db,
      rows.map((row) => row.id),
    );
    const now = new Date();
    return rows.map((row) => toDto(row, usage.get(row.id)!, now));
  }

  async findOne(id: string): Promise<ProgramDto> {
    const row = await this.findRow(id);
    return toDto(row, await programUsage(this.db, id), new Date());
  }

  async create(
    admin: AuthUser,
    input: CreateProgramInput,
  ): Promise<ProgramDto> {
    const now = new Date();
    const id = newProgramId();
    await this.db.transaction(async (tx) => {
      await tx.insert(programs).values({
        id,
        type: input.type,
        name: input.name,
        params: input.params,
        createdAt: now,
        updatedAt: now,
      });
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'PROGRAM_CREATED',
        target: { type: 'PROGRAM', id },
        metadata: { type: input.type, name: input.name },
        at: now,
      });
    });
    return this.findOne(id);
  }

  /** 보낸 필드만 바꾼다. 쓰는 그룹·기기와 이것을 띄우는 라이브의 TV에 알린다 */
  async update(
    admin: AuthUser,
    id: string,
    input: UpdateProgramInput,
  ): Promise<ProgramDto> {
    const current = await this.findRow(id);
    const params =
      input.params === undefined
        ? undefined
        : parseOrFail(definitionOf(current).params, input.params, 'params');
    const changedFields = [
      ...(input.name !== undefined ? ['name'] : []),
      ...(params !== undefined ? ['params'] : []),
    ];

    const now = new Date();
    await this.db.transaction(async (tx) => {
      // undefined 필드는 drizzle이 SET에서 뺀다
      await tx
        .update(programs)
        .set({ name: input.name, params, updatedAt: now })
        .where(eq(programs.id, id));
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'PROGRAM_UPDATED',
        target: { type: 'PROGRAM', id },
        metadata: { changedFields },
        at: now,
      });
    });
    await this.notifyUsers(id);
    return this.findOne(id);
  }

  /**
   * 행을 FOR UPDATE로 잡은 뒤 쓰는 곳을 센다. 편성·기기 예외 저장은 같은 행을 FOR KEY SHARE로
   * 읽으므로 둘 중 먼저 커밋한 쪽이 이긴다(계획 1-5). 라이브가 가리키는 것은 막지 않는다.
   */
  async remove(admin: AuthUser, id: string): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(programs)
        .where(eq(programs.id, id))
        .for('update');
      if (!row) {
        throw notFound();
      }
      const usage = await programUsage(tx, id);
      if (isUsed(usage)) {
        throw inUse(usage);
      }
      await tx.delete(programs).where(eq(programs.id, id));
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'PROGRAM_DELETED',
        target: { type: 'PROGRAM', id },
        metadata: { type: row.type, name: row.name },
        at: now,
      });
    });
  }

  private async notifyUsers(id: string): Promise<void> {
    const [usage, live] = await Promise.all([
      programUsage(this.db, id),
      liveScopesUsing(this.db, id),
    ]);
    for (const groupId of usage.usedByGroupIds) {
      this.signageChanges.emit({ scope: 'GROUP', id: groupId });
    }
    for (const deviceId of usage.usedByDeviceIds) {
      this.signageChanges.emit({ scope: 'DEVICE', id: deviceId });
    }
    for (const { scope, scopeId } of live) {
      this.signageChanges.emit(
        scope === 'DEVICE'
          ? { scope: 'DEVICE', id: scopeId }
          : { scope: 'GROUP', id: scopeId },
      );
    }
  }

  private async findRow(id: string): Promise<Program> {
    const [row] = await this.db
      .select()
      .from(programs)
      .where(eq(programs.id, id));
    if (!row) {
      throw notFound();
    }
    return row;
  }
}

/** 등록에서 빠진 종류의 운영 컨텐츠는 params를 고칠 수 없다(이름은 고칠 수 있다) */
function definitionOf(row: Program): ProgramType {
  const definition = programTypeOf(row.type);
  if (!definition) {
    throw validationFailed({
      params: `더 이상 쓰지 않는 종류(${row.type})라 설정을 고칠 수 없습니다.`,
    });
  }
  return definition;
}

function typeDtoOf(definition: ProgramType): ProgramTypeDto {
  return {
    type: definition.type,
    name: definition.name,
    defaultDurationSeconds: definition.defaultDurationSeconds,
    dataSource: definition.dataSource,
    dataset: null,
    collector: null,
    infoBarItem: definition.infoBarItem ?? null,
    paramsSchema: paramsSchemaOf(definition),
  };
}

/** 폼용 JSON Schema. 날짜처럼 format이 있으면 zod가 붙이는 긴 pattern은 뺀다 */
function paramsSchemaOf(definition: ProgramType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(strip);
    }
    if (node && typeof node === 'object') {
      const entries = Object.entries(node).filter(
        ([key]) => !(key === 'pattern' && 'format' in node),
      );
      return Object.fromEntries(
        entries.map(([key, value]) => [key, strip(value)]),
      );
    }
    return node;
  };
  return strip(openApiOf(definition.params, 'input')) as Record<
    string,
    unknown
  >;
}

function toDto(row: Program, usage: ProgramUsage, now: Date): ProgramDto {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    params: row.params,
    usedByGroupIds: usage.usedByGroupIds,
    usedByDeviceIds: usage.usedByDeviceIds,
    dataStatus: dataStatusOf(row, { now }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function newProgramId(): string {
  return `prg_${randomBytes(6).toString('hex')}`;
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Program not found',
  );
}

function inUse(usage: ProgramUsage): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.IN_USE,
    'Program is used by lineups or devices',
    undefined,
    usage,
  );
}
