import { validateEnv } from './env.js';

const base = {
  DB_HOST: 'localhost',
  DB_USER: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'flyer_g',
  IDP_CLIENT_ID: 'client',
  IDP_CLIENT_SECRET: 'secret',
  JWT_SECRET: 'x'.repeat(32),
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
    const env = validateEnv({
      ...base,
      SWAGGER_USER: 'infoteam',
      SWAGGER_PASSWORD: 'pw',
    });
    expect(env.SWAGGER_USER).toBe('infoteam');
    expect(env.SWAGGER_PASSWORD).toBe('pw');
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
