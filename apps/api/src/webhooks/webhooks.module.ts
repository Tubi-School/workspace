import { Module } from '@nestjs/common';

import { AttendanceModule } from '../attendance/attendance.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ZoomModule } from '../providers/zoom/zoom.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { WebhooksSharedModule } from './webhooks-shared.module.js';
import { ZoomLiveAttendanceIngestionService } from './zoom-live-attendance-ingestion.service.js';
import { ZoomRecordingIngestionService } from './zoom-recording-ingestion.service.js';
import { ZoomWebhooksController } from './zoom-webhooks.controller.js';

@Module({
  imports: [
    ZoomModule,
    AttendanceModule,
    SessionsModule,
    NotificationsModule,
    WebhooksSharedModule,
  ],
  controllers: [ZoomWebhooksController],
  providers: [ZoomLiveAttendanceIngestionService, ZoomRecordingIngestionService],
})
export class WebhooksModule {}
