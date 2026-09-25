import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { UsersService, UserWithRoles } from '../../users/users.service.js';
import type { AuthenticatedRequest } from '../types/auth-user.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const SECRET = 'test-secret-test-secret-test-secret';

const user: UserWithRoles = {
  id: '6f1c2c1e-0000-4000-8000-000000000001',
  idpUuid: 'idp-uuid-1',
  email: 'user@gm.gist.ac.kr',
  name: '홍길동',
  studentId: '20250001',
  lastLoginAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  grantedRoles: ['REVIEWER'],
};

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const jwtService = new JwtService({ secret: SECRET });
  let reflector: Reflector;
  let usersService: { findByIdWithRoles: ReturnType<typeof vi.fn> };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    usersService = { findByIdWithRoles: vi.fn().mockResolvedValue(user) };
    guard = new JwtAuthGuard(
      reflector,
      jwtService,
      usersService as unknown as UsersService,
    );
  });

  it('@Public() 라우트는 토큰 없이 통과한다', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(
      true,
    );
  });

  it('토큰이 없으면 401', async () => {
    await expect(
      guard.canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('Bearer가 아닌 형식이면 401', async () => {
    const token = await jwtService.signAsync({ sub: user.id });
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: `Basic ${token}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('다른 키로 서명된 토큰이면 401', async () => {
    const forged = await new JwtService({
      secret: 'another-secret-another-secret-12345',
    }).signAsync({ sub: user.id });
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: `Bearer ${forged}` } }),
      ),
    ).rejects.toThrow('Invalid access token');
  });

  it('만료된 토큰이면 401 (Access token expired)', async () => {
    const expired = await jwtService.signAsync({
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: `Bearer ${expired}` } }),
      ),
    ).rejects.toThrow('Access token expired');
  });

  it('DB에 없는 사용자면 401', async () => {
    usersService.findByIdWithRoles.mockResolvedValue(null);
    const token = await jwtService.signAsync({ sub: user.id });
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: `Bearer ${token}` } }),
      ),
    ).rejects.toThrow('User not found');
  });

  it('유효한 토큰이면 request.user에 역할과 만료 시각을 넣는다', async () => {
    const token = await jwtService.signAsync(
      { sub: user.id },
      { expiresIn: 3600 },
    );
    const request: Partial<AuthenticatedRequest> = {
      headers: { authorization: `Bearer ${token}` },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(usersService.findByIdWithRoles).toHaveBeenCalledWith(user.id);
    expect(request.user).toMatchObject({
      id: user.id,
      name: '홍길동',
      roles: ['SUBMITTER', 'REVIEWER'],
    });
    expect(request.user!.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
