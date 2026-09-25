import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * JwtAuthGuard는 전역으로 걸려 있어서 모든 라우트가 기본적으로 로그인을 요구한다.
 * 로그인 없이 열어둘 라우트(헬스 체크, 로그인 자체 등)에만 붙인다.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
