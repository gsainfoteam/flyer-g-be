import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.js';

// 비밀번호·시크릿 자리는 실행할 때마다 임의로 만든다.
// 리터럴로 적으면 GitGuardian이 하드코딩된 비밀값으로 탐지한다.
const fakeSecret = () => randomBytes(24).toString('hex');

const base = {
  DB_HOST: 'localhost',
  DB_USER: 'test-user',
  DB_PASSWORD: fakeSecret(),
  DB_NAME: 'flyer_g',
  IDP_CLIENT_ID: 'test-client',
  IDP_CLIENT_SECRET: fakeSecret(),
  JWT_SECRET: fakeSecret(),
  AWS_S3_REGION: 'ap-northeast-2',
  AWS_S3_BUCKET: 'flyer-g-test',
  AWS_ACCESS_KEY_ID: 'test-access-key',
  AWS_SECRET_ACCESS_KEY: fakeSecret(),
};

describe('validateEnv — Swagger 잠금', () => {
  it('둘 다 없으면 잠그지 않는다', () => {
    const env = validateEnv(base);
    expect(env.SWAGGER_USER).toBeUndefined();
    expect(env.SWAGGER_PASSWORD).toBeUndefined();
  });

  it('.env.example처럼 빈 값이면 설정하지 않은 것으로 본다', () => {
    const env = validateEnv({
      ...base,
      SWAGGER_USER: '',
      SWAGGER_PASSWORD: '',
    });
    expect(env.SWAGGER_USER).toBeUndefined();
  });

  it('둘 다 있으면 그대로 쓴다', () => {
    const swaggerPassword = fakeSecret();
    const env = validateEnv({
      ...base,
      SWAGGER_USER: 'infoteam',
      SWAGGER_PASSWORD: swaggerPassword,
    });
    expect(env.SWAGGER_USER).toBe('infoteam');
    expect(env.SWAGGER_PASSWORD).toBe(swaggerPassword);
  });

  it('하나만 있으면 시작 시점에 실패한다', () => {
    expect(() => validateEnv({ ...base, SWAGGER_USER: 'infoteam' })).toThrow(
      /SWAGGER_USER와 SWAGGER_PASSWORD/,
    );
    expect(() =>
      validateEnv({ ...base, SWAGGER_USER: 'infoteam', SWAGGER_PASSWORD: '' }),
    ).toThrow(/SWAGGER_USER와 SWAGGER_PASSWORD/);
  });
});

describe('validateEnv — S3', () => {
  it.each([
    'AWS_S3_REGION',
    'AWS_S3_BUCKET',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ] as const)('%s가 없으면 시작 시점에 실패한다', (key) => {
    const { [key]: _, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(new RegExp(key));
  });
});

describe('validateEnv — 스케줄러', () => {
  it('기본은 켜져 있다', () => {
    expect(validateEnv(base).SCHEDULER_ENABLED).toBe(true);
  });

  it("'false'면 끈다", () => {
    expect(
      validateEnv({ ...base, SCHEDULER_ENABLED: 'false' }).SCHEDULER_ENABLED,
    ).toBe(false);
  });
});
