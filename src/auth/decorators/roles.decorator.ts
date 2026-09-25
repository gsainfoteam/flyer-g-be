import { SetMetadata } from '@nestjs/common';
import type { Role } from '../types/role.js';

export const ROLES_KEY = 'roles';

/**
 * 나열한 역할 중 하나라도 있어야 통과한다. SUPER_ADMIN은 항상 통과한다.
 *
 * @example
 * @Roles('REVIEWER')
 * @Post(':id/approve')
 * approve() {}
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
