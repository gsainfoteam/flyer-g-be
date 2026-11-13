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

describe('validateEnv — 슬랙 알림', () => {
  const webhook = 'https://hooks.slack.com/services/test';
  it('빈 설정은 알림 없이 기존 환경에서 동작한다', () => {
    expect(
      validateEnv({ ...base, SLACK_WEBHOOK_URL: '' }).SLACK_WEBHOOK_URL,
    ).toBeUndefined();
  });
  it('웹훅만 설정해도 알림을 사용할 수 있다', () => {
    expect(
      validateEnv({ ...base, SLACK_WEBHOOK_URL: webhook }).SLACK_WEBHOOK_URL,
    ).toBe(webhook);
  });
  it.each([
    'http://hooks.slack.com/services/test',
    'https://example.com/services/test',
    'invalid-url',
  ])('잘못된 웹훅 %s를 거절한다', (value) => {
    expect(() =>
      validateEnv({
        ...base,
        SLACK_WEBHOOK_URL: value,
      }),
    ).toThrow();
  });
  it('기능별로 끌 수 있다', () => {
    const env = validateEnv({
      ...base,
      SLACK_DEVICE_ALERTS_ENABLED: 'false',
      SLACK_REVIEW_REMINDERS_ENABLED: 'false',
    });
    expect(env.SLACK_DEVICE_ALERTS_ENABLED).toBe(false);
    expect(env.SLACK_REVIEW_REMINDERS_ENABLED).toBe(false);
  });
});

describe('validateEnv — 승인 리마인드 메일', () => {
  it('앱 비밀번호의 표시용 공백을 제거하고 공백뿐인 값은 미설정으로 본다', () => {
    const password = fakeSecret();
    expect(
      validateEnv({
        ...base,
        MAIL_APP_PASSWORD: password.match(/.{1,4}/g)!.join(' '),
      }).MAIL_APP_PASSWORD,
    ).toBe(password);
    expect(
      validateEnv({ ...base, MAIL_APP_PASSWORD: '   ' }).MAIL_APP_PASSWORD,
    ).toBeUndefined();
    expect(() =>
      validateEnv({
        ...base,
        MAIL_REVIEW_REMINDERS_ENABLED: 'true',
        MAIL_USER: 'sender@example.com',
        MAIL_APP_PASSWORD: '   ',
      }),
    ).toThrow(/MAIL_APP_PASSWORD/);
  });
  it('기본은 비활성화이며 하우스 관리자 주소를 사용한다', () => {
    const env = validateEnv(base);
    expect(env.MAIL_REVIEW_REMINDERS_ENABLED).toBe(false);
    expect(env.MAIL_REVIEW_REMINDER_TO).toBe('admin@gist-house.org');
    expect(env.MAIL_FROM_NAME).toBe('Flyer G');
  });
  it('활성화하면 발신 계정과 앱 비밀번호가 모두 필요하다', () => {
    for (const credentials of [
      {},
      { MAIL_USER: 'sender@example.com' },
      { MAIL_APP_PASSWORD: fakeSecret() },
    ]) {
      expect(() =>
        validateEnv({
          ...base,
          ...credentials,
          MAIL_REVIEW_REMINDERS_ENABLED: 'true',
        }),
      ).toThrow(/MAIL_/);
    }
    expect(
      validateEnv({
        ...base,
        MAIL_REVIEW_REMINDERS_ENABLED: 'true',
        MAIL_USER: 'sender@example.com',
        MAIL_APP_PASSWORD: fakeSecret(),
      }).MAIL_REVIEW_REMINDERS_ENABLED,
    ).toBe(true);
  });
  it.each(['MAIL_USER', 'MAIL_FROM_ADDRESS', 'MAIL_REVIEW_REMINDER_TO'])(
    '%s의 잘못된 주소를 거절한다',
    (key) => {
      expect(() => validateEnv({ ...base, [key]: 'invalid-address' })).toThrow(
        new RegExp(key),
      );
    },
  );
  it('오류에 비밀번호 원문을 노출하지 않는다', () => {
    const secret = fakeSecret();
    try {
      validateEnv({
        ...base,
        MAIL_REVIEW_REMINDERS_ENABLED: 'true',
        MAIL_APP_PASSWORD: secret,
      });
      expect.fail('발신 계정이 없으면 실패해야 한다');
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

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

describe('validateEnv — 영상 업로드', () => {
  it('기본은 꺼져 있다', () => {
    expect(validateEnv(base).VIDEO_UPLOADS_ENABLED).toBe(false);
  });

  it("'true'면 켠다", () => {
    expect(
      validateEnv({ ...base, VIDEO_UPLOADS_ENABLED: 'true' })
        .VIDEO_UPLOADS_ENABLED,
    ).toBe(true);
  });
});

describe('validateEnv — CORS', () => {
  it('비우면 허용 origin이 없다', () => {
    expect(validateEnv(base).CORS_ALLOWED_ORIGINS).toEqual([]);
    expect(
      validateEnv({ ...base, CORS_ALLOWED_ORIGINS: '' }).CORS_ALLOWED_ORIGINS,
    ).toEqual([]);
  });

  it('쉼표로 나누고 공백·끝의 /를 정리한다', () => {
    expect(
      validateEnv({
        ...base,
        CORS_ALLOWED_ORIGINS:
          ' https://stg.flyer-g.gistory.me/ , http://localhost:5173 ',
      }).CORS_ALLOWED_ORIGINS,
    ).toEqual(['https://stg.flyer-g.gistory.me', 'http://localhost:5173']);
  });

  it.each([
    ['경로가 붙은 값', 'https://flyer-g.gistory.me/app'],
    ['scheme 없는 값', 'flyer-g.gistory.me'],
    ['http(s)가 아닌 값', 'ftp://flyer-g.gistory.me'],
    ['와일드카드', '*'],
  ])('%s은 시작 시점에 거절한다', (_, value) => {
    expect(() => validateEnv({ ...base, CORS_ALLOWED_ORIGINS: value })).toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
  });
});
