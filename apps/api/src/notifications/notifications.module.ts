import { Module } from '@nestjs/common';

import { EmailProviderService } from './email-provider.service.js';
import { NotificationDispatchScheduler } from './notification-dispatch.scheduler.js';
import { NotificationsService } from './notifications.service.js';
import { SessionReminderScheduler } from './session-reminder.scheduler.js';

@Module({
  providers: [
    NotificationsService,
    EmailProviderService,
    NotificationDispatchScheduler,
    SessionReminderScheduler,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
