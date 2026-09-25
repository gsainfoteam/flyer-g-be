import { z } from 'zod';

/** `KEY=`처럼 빈 값으로 둔 선택 항목은 설정하지 않은 것으로 본다. */
const optionalString = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().optional(),
);

/**
 * 앱이 뜨기 위해 반드시 있어야 하는 환경변수 목록.
 * 값이 없거나 형식이 틀리면 서버가 "시작 시점에" 죽는다.
 *
 * DB 접속 정보를 DATABASE_URL 한 줄이 아니라 6개로 쪼갠 이유:
 * GitGuardian 같은 시크릿 탐지 도구가 postgresql://user:pass@host 형태를
 * 유출로 오탐하기 때문. chatbot-be 등 인포팀 다른 프로젝트도 같은 방식이다.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['local', 'dev', 'prod']).default('local'),
    PORT: z.coerce.number().int().positive().default(3000),

    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().min(1),
    // 환경변수는 항상 문자열이라 'true'/'false' 문자열로 받아서 boolean으로 바꾼다.
    DB_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Infoteam IdP (OAuth 2.0 / OIDC). 클라이언트 정보는 IdP 콘솔에서 발급받는다.
    IDP_URL: z.url().default('https://api.account.gistory.me'),
    IDP_CLIENT_ID: z.string().min(1),
    IDP_CLIENT_SECRET: z.string().min(1),

    // 우리 서버가 자체 발급하는 access token(JWT) 서명 키와 만료 시간(초).
    JWT_SECRET: z.string().min(32, 'JWT_SECRET은 32자 이상이어야 합니다'),
    JWT_EXPIRES_IN: z.coerce.number().int().min(60).max(86400).default(3600),

    // 둘 다 설정하면 Swagger 문서(/docs)를 Basic Auth로 잠근다. 둘 다 비우면 공개.
    SWAGGER_USER: optionalString,
    SWAGGER_PASSWORD: optionalString,
  })
  // 하나만 설정하면 잠긴 줄 알고 문서가 공개된 채로 배포될 수 있으니 시작 시점에 막는다.
  .refine((env) => !env.SWAGGER_USER === !env.SWAGGER_PASSWORD, {
    message:
      'SWAGGER_USER와 SWAGGER_PASSWORD는 둘 다 설정하거나 둘 다 비워야 합니다',
    path: ['SWAGGER_PASSWORD'],
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`환경변수 설정이 올바르지 않습니다:\n${details}`);
  }

  return parsed.data;
}
