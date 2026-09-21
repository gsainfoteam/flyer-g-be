import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';

/** DI 토큰. 서비스에서 @Inject(DB_CONNECTION)으로 DB를 주입받는다. */
export const DB_CONNECTION = Symbol('DB_CONNECTION');

export interface DatabaseConnectionParams {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslEnabled: boolean;
}

export function createDatabaseConnection(params: DatabaseConnectionParams) {
  const client = postgres({
    host: params.host,
    port: params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    ssl: params.sslEnabled ? { rejectUnauthorized: false } : false,
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabaseConnection>;

// Postgres advisory lock 번호. 프로젝트마다 달라야 한다.
// 파드가 여러 개 동시에 뜰 때 마이그레이션이 겹쳐 돌지 않게 막는 용도.
const LOCK_A = 1179207269;
const LOCK_B = 1650549857;
const LOCK_TIMEOUT_MS = 30_000;

/**
 * drizzle/ 폴더의 마이그레이션 SQL을 DB에 적용한다.
 * 이미 적용된 건 drizzle이 알아서 건너뛴다.
 */
export async function runMigrations(
  params: DatabaseConnectionParams,
  migrationsFolder = './drizzle',
): Promise<void> {
  // max: 1 — lock과 unlock이 같은 커넥션에서 일어나야 하므로 하나만 쓴다.
  const client = postgres({
    host: params.host,
    port: params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    ssl: params.sslEnabled ? { rejectUnauthorized: false } : false,
    max: 1,
  });

  try {
    await client.unsafe(`SET lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await client.unsafe(`SELECT pg_advisory_lock(${LOCK_A}, ${LOCK_B})`);
    await client.unsafe('SET lock_timeout = DEFAULT');

    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client
      .unsafe(`SELECT pg_advisory_unlock(${LOCK_A}, ${LOCK_B})`)
      .catch(() => undefined);
    await client.end();
  }
}
