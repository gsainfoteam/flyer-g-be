import type { Request } from 'express';
import type { Role } from './role.js';

/** 우리 서버가 발급하는 access token(JWT)의 payload */
export type AccessTokenPayload = {
  /** users.id */
  sub: string;
  iat?: number;
  exp?: number;
};

/** JwtAuthGuard가 검증을 마치고 request.user에 넣어주는 값 */
export type AuthUser = {
  id: string;
  idpUuid: string;
  email: string;
  name: string;
  roles: Role[];
  /** 현재 access token의 만료 시각 */
  tokenExpiresAt: Date;
};

export type AuthenticatedRequest = Request & { user?: AuthUser };
