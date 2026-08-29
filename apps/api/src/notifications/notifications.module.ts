import { Module } from '@nestjs/common';

import { EmailProviderService } from './email-provider.service.js';
import { NotificationDispatchScheduler } from './notification-dispatch.scheduler.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { SessionReminderScheduler } from './session-reminder.scheduler.js';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    EmailProviderService,
    NotificationDispatchScheduler,
    SessionReminderScheduler,
  ],
  exports: [NotificationsService, EmailProviderService],
})
export class NotificationsModule {}
