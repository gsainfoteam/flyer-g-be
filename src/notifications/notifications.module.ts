import { Module } from '@nestjs/common';
import { MailService } from './mail.service.js';
import { MailDispatcher } from './mail-dispatcher.service.js';
import { NotificationDispatcher } from './notification-dispatcher.service.js';
import { SlackNotificationService } from './slack-notification.service.js';

@Module({
  providers: [
    SlackNotificationService,
    NotificationDispatcher,
    MailService,
    MailDispatcher,
  ],
  exports: [
    SlackNotificationService,
    NotificationDispatcher,
    MailService,
    MailDispatcher,
  ],
})
export class NotificationsModule {}
