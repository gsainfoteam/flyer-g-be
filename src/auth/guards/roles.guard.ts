import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../types/auth-user.js';
import type { Role } from '../types/role.js';

/**
 * 전역 Guard. JwtAuthGuard 다음에 실행되며 @Roles()가 붙은 라우트만 검사한다.
 * SUPER_ADMIN은 모든 역할 검사를 통과한다.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const roles = user?.roles ?? [];
    if (
      roles.includes('SUPER_ADMIN') ||
      required.some((role) => roles.includes(role))
    ) {
      return true;
    }
    throw new ForbiddenException('Insufficient role');
  }
}
