import { Trace } from '@gsainfoteam/nest-observability';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/types/auth-user.js';
import {
  AppException,
  type FieldErrors,
} from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { validationFailed } from '../common/errors/validation.js';
import { DB_CONNECTION, type Database } from '../db/index.js';
import {
  deviceTargetGroups,
  devices,
  liveStates,
  programs,
  submissions,
  targetGroups,
  users,
  type LiveScope,
} from '../db/schema.js';
import {
  SignageChanges,
  type SignageChange,
} from '../realtime/signage-changes.js';
import { NO_LIVE, type LiveDto } from './dto/live.dto.js';
import {
  MAX_GAME_DURATION_MS,
  type LiveAlert,
  type LiveInput,
  type LiveMain,
} from './live-schema.js';
import { activeLayer, resolveLive, type LiveLayer } from './resolve-live.js';

/**
 * 라이브 상태(FE 요청 3-1). 기기와 그룹마다 하나씩 두고, 기기 값이 그룹 값보다 우선한다.
 * until이 지나도 지우지 않는다. 읽을 때 판정한다(계획 1-4).
 * 가리키는 신청·운영 컨텐츠는 쓸 때 있는지만 본다. 게시 중인지, 그 뒤 지워졌는지는 편성을 만들 때 본다.
 */
@Trace()
@Injectable()
export class LiveService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
    private readonly signageChanges: SignageChanges,
  ) {}

  /** 그 범위에 저장된 라이브. until이 지난 부분은 뺀다 */
  async get(scope: LiveScope, scopeId: string): Promise<LiveDto> {
    await this.assertTarget(scope, scopeId);
    const [layer] = await this.layersOf([{ scope, scopeId }]);
    return liveDtoOf(activeLayer(layer?.layer ?? null, new Date())) ?? NO_LIVE;
  }

  /** 그 범위의 라이브를 통째로 바꾼다. main·alert가 모두 null이면 해제와 같다 */
  async set(
    admin: AuthUser,
    scope: LiveScope,
    scopeId: string,
    input: LiveInput,
  ): Promise<LiveDto> {
    if (!input.main && !input.alert) {
      await this.clear(admin, scope, scopeId);
      return NO_LIVE;
    }
    await this.assertTarget(scope, scopeId);
    const now = new Date();
    const main = input.main && normalizeMain(input.main);
    const alert = input.alert && normalizeAlert(input.alert);
    const fields = {
      ...timeErrors(main, alert, now),
      ...(await this.referenceErrors(main)),
    };
    if (Object.keys(fields).length > 0) {
      throw validationFailed(fields);
    }

    await this.db.transaction(async (tx) => {
      const values = { main, alert, setBy: admin.id, setAt: now };
      await tx
        .insert(liveStates)
        .values({ scope, scopeId, ...values })
        .onConflictDoUpdate({
          target: [liveStates.scope, liveStates.scopeId],
          set: values,
        });
      await this.auditService.record(tx, {
        actor: { type: 'USER', id: admin.id },
        action: 'LIVE_SET',
        target: { type: scope, id: scopeId },
        metadata: { main, alert },
        at: now,
      });
    });
    this.signageChanges.emit(changeOf(scope, scopeId));
    return this.get(scope, scopeId);
  }

  /** 편성으로 돌아간다. 저장된 라이브가 있었을 때만 감사 로그를 남긴다 */
  async clear(
    admin: AuthUser,
    scope: LiveScope,
    scopeId: string,
  ): Promise<void> {
    await this.assertTarget(scope, scopeId);
    const now = new Date();
    const cleared = await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(liveStates)
        .where(
          and(eq(liveStates.scope, scope), eq(liveStates.scopeId, scopeId)),
        )
        .returning({ scopeId: liveStates.scopeId });
      if (deleted.length > 0) {
        await this.auditService.record(tx, {
          actor: { type: 'USER', id: admin.id },
          action: 'LIVE_CLEARED',
          target: { type: scope, id: scopeId },
          at: now,
        });
      }
      return deleted.length > 0;
    });
    if (cleared) {
      this.signageChanges.emit(changeOf(scope, scopeId));
    }
  }

  /**
   * 기기마다 실제로 띄울 라이브. groupIdsByDevice는 기기가 속한 위치 그룹이다.
   * 그룹 라이브는 그 그룹에 속한 모든 기기에 나간다.
   */
  async effectiveFor(
    groupIdsByDevice: ReadonlyMap<string, string[]>,
    now: Date,
  ): Promise<Map<string, LiveLayer | null>> {
    const deviceIds = [...groupIdsByDevice.keys()];
    const groupIds = [...new Set([...groupIdsByDevice.values()].flat())];
    const layers = await this.layersOf([
      ...deviceIds.map((id) => ({ scope: 'DEVICE' as const, scopeId: id })),
      ...groupIds.map((id) => ({ scope: 'GROUP' as const, scopeId: id })),
    ]);
    const layerOf = (scope: LiveScope, id: string) =>
      layers.find((row) => row.scope === scope && row.scopeId === id)?.layer ??
      null;

    return new Map(
      deviceIds.map((deviceId) => [
        deviceId,
        resolveLive(
          layerOf('DEVICE', deviceId),
          (groupIdsByDevice.get(deviceId) ?? []).flatMap((groupId) => {
            const layer = layerOf('GROUP', groupId);
            return layer ? [layer] : [];
          }),
          now,
        ),
      ]),
    );
  }

  /** 기기 하나의 실제 라이브. 기기 그룹을 직접 읽는다 */
  async effectiveForDevice(
    deviceId: string,
    now: Date,
  ): Promise<LiveLayer | null> {
    const rows = await this.db
      .select({ groupId: deviceTargetGroups.targetGroupId })
      .from(deviceTargetGroups)
      .where(eq(deviceTargetGroups.deviceId, deviceId));
    const live = await this.effectiveFor(
      new Map([[deviceId, rows.map((row) => row.groupId)]]),
      now,
    );
    return live.get(deviceId) ?? null;
  }

  private async layersOf(
    keys: { scope: LiveScope; scopeId: string }[],
  ): Promise<{ scope: LiveScope; scopeId: string; layer: LiveLayer }[]> {
    const ofScope = (scope: LiveScope) =>
      keys.filter((key) => key.scope === scope).map((key) => key.scopeId);
    const conditions = (['DEVICE', 'GROUP'] as const).flatMap((scope) => {
      const ids = ofScope(scope);
      return ids.length > 0
        ? [and(eq(liveStates.scope, scope), inArray(liveStates.scopeId, ids))]
        : [];
    });
    if (conditions.length === 0) {
      return [];
    }
    const rows = await this.db
      .select({
        state: liveStates,
        editor: { id: users.id, name: users.name },
      })
      .from(liveStates)
      .innerJoin(users, eq(users.id, liveStates.setBy))
      .where(or(...conditions));
    return rows.map(({ state, editor }) => ({
      scope: state.scope,
      scopeId: state.scopeId,
      layer: {
        main: state.main,
        alert: state.alert,
        setBy: editor,
        setAt: state.setAt,
      },
    }));
  }

  private async assertTarget(scope: LiveScope, scopeId: string): Promise<void> {
    const [row] =
      scope === 'DEVICE'
        ? await this.db
            .select({ id: devices.id })
            .from(devices)
            .where(eq(devices.id, scopeId))
        : await this.db
            .select({ id: targetGroups.id })
            .from(targetGroups)
            .where(eq(targetGroups.id, scopeId));
    if (!row) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        scope === 'DEVICE' ? 'Device not found' : 'Target group not found',
      );
    }
  }

  /** 가리키는 대상이 있는지만 본다. 신청은 대상 그룹·상태와 상관없다(FE 7-2) */
  private async referenceErrors(main: LiveMain | null): Promise<FieldErrors> {
    if (main?.action !== 'SHOW') {
      return {};
    }
    if (main.submissionId) {
      const [row] = await this.db
        .select({ id: submissions.id })
        .from(submissions)
        .where(eq(submissions.id, main.submissionId));
      return row ? {} : { 'main.submissionId': '없는 신청입니다.' };
    }
    const [row] = await this.db
      .select({ id: programs.id })
      .from(programs)
      .where(eq(programs.id, main.programId!));
    return row ? {} : { 'main.programId': '없는 운영 컨텐츠입니다.' };
  }
}

/** 시각은 UTC ISO로, 해당 없는 참조는 null로 맞춘다 */
function normalizeMain(main: LiveMain): LiveMain {
  if (main.action === 'GAME') {
    return { ...main, until: new Date(main.until).toISOString() };
  }
  return {
    action: 'SHOW',
    submissionId: main.submissionId ?? null,
    programId: main.programId ?? null,
    until: main.until ? new Date(main.until).toISOString() : null,
  };
}

function normalizeAlert(alert: LiveAlert): LiveAlert {
  return {
    text: alert.text,
    until: alert.until ? new Date(alert.until).toISOString() : null,
  };
}

function timeErrors(
  main: LiveMain | null,
  alert: LiveAlert | null,
  now: Date,
): FieldErrors {
  const fields: FieldErrors = {};
  const future = (until: string) => Date.parse(until) > now.getTime();
  if (main?.action === 'GAME') {
    if (
      !future(main.until) ||
      Date.parse(main.until) > now.getTime() + MAX_GAME_DURATION_MS
    ) {
      fields['main.until'] = '게임 끝 시각은 지금부터 3시간 안이어야 합니다.';
    }
  } else if (main?.until && !future(main.until)) {
    fields['main.until'] = '끝 시각은 지금보다 뒤여야 합니다.';
  }
  if (alert?.until && !future(alert.until)) {
    fields['alert.until'] = '끝 시각은 지금보다 뒤여야 합니다.';
  }
  return fields;
}

function changeOf(scope: LiveScope, id: string): SignageChange {
  return scope === 'DEVICE' ? { scope: 'DEVICE', id } : { scope: 'GROUP', id };
}

export function liveDtoOf(layer: LiveLayer | null): LiveDto | null {
  return (
    layer && {
      main: layer.main,
      alert: layer.alert,
      setBy: layer.setBy,
      setAt: layer.setAt.toISOString(),
    }
  );
}
