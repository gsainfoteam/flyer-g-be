import { Module } from '@nestjs/common';
import { PolicyController } from './policy.controller.js';

/** 정책 값 자체는 src/policy/signage-policy.ts의 상수를 직접 import해 쓴다. */
@Module({
  controllers: [PolicyController],
})
export class PolicyModule {}
