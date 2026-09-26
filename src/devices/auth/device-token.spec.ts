import {
  generateDeviceToken,
  hashDeviceToken,
  looksLikeDeviceToken,
} from './device-token.js';

describe('device token', () => {
  it('접두어가 붙은 43자 base64url 값을 만든다', () => {
    const token = generateDeviceToken();
    expect(token).toMatch(/^fgd_[A-Za-z0-9_-]{43}$/);
    expect(looksLikeDeviceToken(token)).toBe(true);
  });

  it('매번 다른 값이다', () => {
    expect(generateDeviceToken()).not.toBe(generateDeviceToken());
  });

  it('해시는 64자 hex이고 같은 토큰이면 같다', () => {
    const token = generateDeviceToken();
    expect(hashDeviceToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
  });

  it.each(['', 'fgd_short', 'Bearer abc', `xyz_${'a'.repeat(43)}`])(
    '%s는 기기 토큰 형식이 아니다',
    (value) => {
      expect(looksLikeDeviceToken(value)).toBe(false);
    },
  );
});
