import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import type { IdpService } from '../idp/idp.service.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './types/auth-user.js';

const SECRET = 'test-secret-test-secret-test-secret';
const USER_ID = '6f1c2c1e-0000-4000-8000-000000000001';

describe('AuthService', () => {
  const jwtService = new JwtService({ secret: SECRET });
  const config = {
    get: () => 3600,
  } as unknown as ConfigService<Env, true>;

  let idp: {
    exchangeCode: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    getUserInfo: ReturnType<typeof vi.fn>;
  };
  let users: { upsertFromIdp: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    const idpToken = {
      access_token: 'idp-access',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'idp-refresh-2',
    };
    idp = {
      exchangeCode: vi.fn().mockResolvedValue(idpToken),
      refresh: vi.fn().mockResolvedValue(idpToken),
      getUserInfo: vi.fn().mockResolvedValue({
        uuid: 'idp-uuid-1',
        name: '홍길동',
        email: 'user@gm.gist.ac.kr',
      }),
    };
    users = { upsertFromIdp: vi.fn().mockResolvedValue({ id: USER_ID }) };
    service = new AuthService(
      idp as unknown as IdpService,
      users as unknown as UsersService,
      jwtService,
      config,
    );
  });

  it('login: code 교환 → userinfo → upsert → 자체 토큰 발급', async () => {
    const result = await service.login('code', 'http://localhost/cb', 'v');

    expect(idp.exchangeCode).toHaveBeenCalledWith(
      'code',
      'http://localhost/cb',
      'v',
    );
    expect(idp.getUserInfo).toHaveBeenCalledWith('idp-access');
    expect(users.upsertFromIdp).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'idp-uuid-1' }),
    );
    expect(result.refreshToken).toBe('idp-refresh-2');
    expect(result.expiresIn).toBe(3600);

    const payload = await jwtService.verifyAsync(result.accessToken);
    expect(payload.sub).toBe(USER_ID);
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it('refresh: IdP가 거부하면 토큰을 발급하지 않는다', async () => {
    idp.refresh.mockRejectedValue(new UnauthorizedException());
    await expect(service.refresh('stale')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.upsertFromIdp).not.toHaveBeenCalled();
  });

  it('toSession: 프론트 계약 형태로 변환한다', () => {
    const user: AuthUser = {
      id: USER_ID,
      idpUuid: 'idp-uuid-1',
      email: 'user@gm.gist.ac.kr',
      name: '홍길동',
      roles: ['SUBMITTER'],
      tokenExpiresAt: new Date('2026-07-29T12:00:00.000Z'),
    };
    expect(service.toSession(user)).toEqual({
      user: {
        id: USER_ID,
        displayName: '홍길동',
        email: 'user@gm.gist.ac.kr',
        roles: ['SUBMITTER'],
        organizationIds: [],
      },
      expiresAt: '2026-07-29T12:00:00.000Z',
    });
  });
});
