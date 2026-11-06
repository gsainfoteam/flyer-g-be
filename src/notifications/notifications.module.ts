import { Module } from '@nestjs/common';
import { NotificationDispatcher } from './notification-dispatcher.service.js';
import { SlackNotificationService } from './slack-notification.service.js';

@Module({
  providers: [SlackNotificationService, NotificationDispatcher],
  exports: [SlackNotificationService, NotificationDispatcher],
})
export class NotificationsModule {}
