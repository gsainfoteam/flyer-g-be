import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { z } from 'zod';
import type { Env } from '../config/env.js';
import {
  idpTokenResponseSchema,
  idpUserInfoSchema,
  type IdpTokenResponse,
  type IdpUserInfo,
} from './idp.types.js';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Infoteam IdP(OAuth 2.0 / OIDC)와 통신하는 클라이언트.
 * 엔드포인트는 {IDP_URL}/.well-known/openid-configuration 기준이다.
 *
 * IdP 쪽 오류는 두 가지로만 나눈다.
 * - 사용자가 가져온 code/token이 잘못됨 → 401
 * - IdP 장애·네트워크 오류·예상 밖 응답 → 502
 */
@Injectable()
export class IdpService {
  private readonly logger = new Logger(IdpService.name);
  private readonly idpUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(config: ConfigService<Env, true>) {
    this.idpUrl = config.get('IDP_URL', { infer: true }).replace(/\/+$/, '');
    this.clientId = config.get('IDP_CLIENT_ID', { infer: true });
    this.clientSecret = config.get('IDP_CLIENT_SECRET', { infer: true });
  }

  /** authorization code를 IdP 토큰으로 교환한다. (PKCE 사용 시 codeVerifier 필요) */
  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<IdpTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    if (codeVerifier) {
      body.set('code_verifier', codeVerifier);
    }
    return this.requestToken(body, 'Invalid authorization code');
  }

  /** IdP refresh token으로 새 IdP 토큰을 받는다. */
  async refresh(refreshToken: string): Promise<IdpTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.requestToken(body, 'Invalid refresh token');
  }

  /** IdP access token으로 사용자 정보를 조회한다. */
  async getUserInfo(accessToken: string): Promise<IdpUserInfo> {
    const response = await this.send('/oauth/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      throw new UnauthorizedException('Invalid IdP access token');
    }
    const data = await this.parse(response, idpUserInfoSchema, 'userinfo');

    return {
      uuid: data.sub,
      name: data.name,
      email: data.email,
      studentId: data.student_id,
    };
  }

  private async requestToken(
    body: URLSearchParams,
    unauthorizedMessage: string,
  ): Promise<IdpTokenResponse> {
    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64');

    const response = await this.send('/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    // 400 invalid_grant: code 재사용·만료, redirect_uri 불일치, code_verifier 불일치 등
    if (response.status === 400 || response.status === 401) {
      const detail = await response.text().catch(() => '');
      this.logger.warn(`IdP token 요청 거부 (${response.status}): ${detail}`);
      throw new UnauthorizedException(unauthorizedMessage);
    }
    return this.parse(response, idpTokenResponseSchema, 'token');
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(this.idpUrl + path, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`IdP 요청 실패: ${path}`, error);
      throw new BadGatewayException('Identity provider is unavailable');
    }
  }

  private async parse<T extends z.ZodType>(
    response: Response,
    schema: T,
    label: string,
  ): Promise<z.infer<T>> {
    if (!response.ok) {
      this.logger.error(`IdP ${label} 응답 오류: ${response.status}`);
      throw new BadGatewayException('Identity provider returned an error');
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      // userinfo에서 나면 대개 프론트가 authorize 요청에 profile/email scope를 빠뜨린 경우다.
      this.logger.error(
        `IdP ${label} 응답 형식이 예상과 다릅니다: ${parsed.error.message}`,
      );
      throw new BadGatewayException(
        'Unexpected response from identity provider',
      );
    }
    return parsed.data;
  }
}
