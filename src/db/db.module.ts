import { Global, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import {
  DB_CONNECTION,
  createDatabaseConnection,
  runMigrations,
  type Database,
  type DatabaseConnectionParams,
} from './index.js';

/** ConfigService에서 DB 접속 정보를 꺼내 한 덩어리로 만든다. */
function dbParamsFrom(config: ConfigService<Env, true>): DatabaseConnectionParams {
  return {
    host: config.get('DB_HOST', { infer: true }),
    port: config.get('DB_PORT', { infer: true }),
    user: config.get('DB_USER', { infer: true }),
    password: config.get('DB_PASSWORD', { infer: true }),
    database: config.get('DB_NAME', { infer: true }),
    sslEnabled: config.get('DB_SSL', { infer: true }),
  };
}

/**
 * @Global() — 한 번만 등록하면 모든 모듈에서 DB_CONNECTION을 주입받을 수 있다.
 * 모듈마다 imports에 적어줄 필요가 없어진다.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      useFactory: (config: ConfigService<Env, true>): Database =>
        createDatabaseConnection(dbParamsFrom(config)),
      inject: [ConfigService],
    },
  ],
  exports: [DB_CONNECTION],
})
export class DbModule implements OnModuleInit {
  private readonly logger = new Logger(DbModule.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** 서버가 요청을 받기 전에 마이그레이션을 먼저 적용한다. */
  async onModuleInit(): Promise<void> {
    this.logger.log('마이그레이션 확인 중...');
    await runMigrations(dbParamsFrom(this.config));
    this.logger.log('마이그레이션 완료');
  }
}
