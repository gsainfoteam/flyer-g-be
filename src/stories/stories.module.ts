import { Module } from '@nestjs/common';
import { StoriesController } from './stories.controller.js';
import { StoriesService } from './stories.service.js';

/** 소식 제보의 공개 조회. 신청·검토는 submissions·reviews 모듈이 한다 */
@Module({
  controllers: [StoriesController],
  providers: [StoriesService],
})
export class StoriesModule {}
