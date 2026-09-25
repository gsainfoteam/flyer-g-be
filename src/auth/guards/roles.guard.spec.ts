import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../types/auth-user.js';
import type { Role } from '../types/role.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(roles?: Role[]): ExecutionContext {
  const user = roles ? ({ roles } as AuthUser) : undefined;
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  const requireRoles = (roles: Role[] | undefined) =>
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('@Roles()가 없으면 통과한다', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextFor(['SUBMITTER']))).toBe(true);
  });

  it('필요한 역할 중 하나가 있으면 통과한다', () => {
    requireRoles(['REVIEWER']);
    expect(guard.canActivate(contextFor(['SUBMITTER', 'REVIEWER']))).toBe(true);
  });

  it('필요한 역할이 없으면 403', () => {
    requireRoles(['REVIEWER']);
    expect(() => guard.canActivate(contextFor(['SUBMITTER']))).toThrow(
      ForbiddenException,
    );
  });

  it('SUPER_ADMIN은 모든 역할 검사를 통과한다', () => {
    requireRoles(['REVIEWER']);
    expect(guard.canActivate(contextFor(['SUBMITTER', 'SUPER_ADMIN']))).toBe(
      true,
    );
  });

  it('request.user가 없으면 403', () => {
    requireRoles(['SUBMITTER']);
    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });
});
