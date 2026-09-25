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
