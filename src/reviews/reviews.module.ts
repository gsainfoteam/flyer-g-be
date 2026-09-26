import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { SubmissionsModule } from '../submissions/submissions.module.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  imports: [AssetsModule, AuditModule, SubmissionsModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
