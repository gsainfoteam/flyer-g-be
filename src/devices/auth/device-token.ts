import { createHash, randomBytes } from 'node:crypto';

// 로그·코드에서 기기 토큰임을 알아보고, 시크릿 스캐너가 잡을 수 있게 접두어를 붙인다.
const PREFIX = 'fgd_';

/** 256비트 임의 값. 추측이 불가능하므로 느린 해시(bcrypt 등) 없이 sha256으로 저장한다. */
export function generateDeviceToken(): string {
  return `${PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function looksLikeDeviceToken(value: string): boolean {
  return /^fgd_[A-Za-z0-9_-]{43}$/.test(value);
}
