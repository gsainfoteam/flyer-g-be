import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../users/users.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type {
  AccessTokenPayload,
  AuthenticatedRequest,
} from '../types/auth-user.js';
import { resolveRoles } from '../types/role.js';

/**
 * 전역 Guard. `Authorization: Bearer <access token>`을 검증하고
 * request.user에 현재 사용자를 넣는다. @Public() 라우트는 건너뛴다.
 *
 * 역할은 토큰에 넣지 않고 매 요청 DB에서 읽는다.
 * 역할을 부여·회수하면 토큰 만료를 기다리지 않고 바로 반영된다.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const payload = await this.verify(token);
    const user = await this.usersService.findByIdWithRoles(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    request.user = {
      id: user.id,
      idpUuid: user.idpUuid,
      email: user.email,
      name: user.name,
      roles: resolveRoles(user.grantedRoles),
      tokenExpiresAt: new Date((payload.exp ?? 0) * 1000),
    };
    return true;
  }

  private async verify(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Access token expired');
      }
      throw new UnauthorizedException('Invalid access token');
    }
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  const [type, token] = header?.split(' ') ?? [];
  return type === 'Bearer' && token ? token : undefined;
}
