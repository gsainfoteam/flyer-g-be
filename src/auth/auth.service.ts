import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { IdpService } from '../idp/idp.service.js';
import type { IdpTokenResponse } from '../idp/idp.types.js';
import { UsersService } from '../users/users.service.js';
import type { SessionResponseDto, TokenResponseDto } from './dto/auth.dto.js';
import type { AccessTokenPayload, AuthUser } from './types/auth-user.js';

/**
 * 로그인 흐름 (chatbot-be와 같은 방식)
 * 1. 프론트가 IdP authorize로 보내고 redirect로 code를 받는다.
 * 2. 프론트가 code를 POST /auth/login으로 넘긴다.
 * 3. 서버가 code를 IdP 토큰으로 바꾸고, userinfo로 사용자를 확인해 DB에 반영한다.
 * 4. 서버가 자체 access token(JWT)을 발급하고, IdP refresh token은 그대로 전달한다.
 */
@Injectable()
export class AuthService {
  private readonly expiresIn: number;

  constructor(
    private readonly idpService: IdpService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.expiresIn = config.get('JWT_EXPIRES_IN', { infer: true });
  }

  async login(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<TokenResponseDto> {
    const idpToken = await this.idpService.exchangeCode(
      code,
      redirectUri,
      codeVerifier,
    );
    return this.issue(idpToken);
  }

  /** IdP에서도 refresh가 거부되면(탈퇴·세션 회수 등) 우리 토큰도 새로 주지 않는다. */
  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    const idpToken = await this.idpService.refresh(refreshToken);
    return this.issue(idpToken);
  }

  toSession(user: AuthUser): SessionResponseDto {
    return {
      user: {
        id: user.id,
        displayName: user.name,
        email: user.email,
        roles: user.roles,
        // 조직 모델은 게시 신청(5절) 작업 때 설계한다.
        organizationIds: [],
      },
      expiresAt: user.tokenExpiresAt.toISOString(),
    };
  }

  private async issue(idpToken: IdpTokenResponse): Promise<TokenResponseDto> {
    const userInfo = await this.idpService.getUserInfo(idpToken.access_token);
    const user = await this.usersService.upsertFromIdp(userInfo);

    const payload: AccessTokenPayload = { sub: user.id };
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: this.expiresIn,
    });

    return {
      accessToken,
      refreshToken: idpToken.refresh_token,
      expiresIn: this.expiresIn,
    };
  }
}
