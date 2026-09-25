import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';
import type { Role } from '../types/role.js';

export class LoginRequestDto {
  /** IdP authorize 후 redirect로 받은 authorization code */
  @IsString()
  @IsNotEmpty()
  code: string;

  /** authorize 요청에 썼던 redirect_uri와 정확히 같아야 한다 */
  @IsUrl({ require_tld: false, require_protocol: true })
  redirectUri: string;

  /** PKCE를 썼다면 code_challenge를 만든 원본 값 */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  codeVerifier?: string;
}

export class RefreshRequestDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class TokenResponseDto {
  /** 우리 서버가 발급한 access token. `Authorization: Bearer`로 보낸다 */
  accessToken: string;
  /** IdP refresh token. authorize 때 offline_access scope를 요청해야 내려온다 */
  refreshToken?: string;
  /** accessToken 유효 시간(초) */
  expiresIn: number;
}

export class SessionResponseDto {
  user: {
    id: string;
    displayName: string;
    email: string;
    roles: Role[];
    organizationIds: string[];
  };
  /** 현재 access token 만료 시각 (UTC ISO 8601) */
  expiresAt: string;
}
