import { z } from 'zod';

/**
 * 앱이 뜨기 위해 반드시 있어야 하는 환경변수 목록.
 * 값이 없거나 형식이 틀리면 서버가 "시작 시점에" 죽는다.
 * (런타임 중간에 undefined로 터지는 것보다 훨씬 빨리 알아챌 수 있다)
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['local', 'dev', 'prod']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
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
