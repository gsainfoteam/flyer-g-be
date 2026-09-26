import type { GrantedRole } from '../../db/schema.js';

/**
 * 프론트 route guard가 쓰는 역할 이름과 같다.
 * - SUBMITTER: 로그인한 모든 사용자 (DB에 저장하지 않음)
 * - REVIEWER, SUPER_ADMIN: user_roles 테이블로 부여
 */
export type Role = 'SUBMITTER' | GrantedRole;

export function resolveRoles(grantedRoles: GrantedRole[]): Role[] {
  return ['SUBMITTER', ...grantedRoles];
}

/** 검토 권한. SUPER_ADMIN은 모든 역할을 가진 것으로 본다(RolesGuard와 같은 규칙). */
export function isReviewer(roles: Role[]): boolean {
  return roles.includes('REVIEWER') || roles.includes('SUPER_ADMIN');
}
