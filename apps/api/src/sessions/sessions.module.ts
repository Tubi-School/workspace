import { Module } from '@nestjs/common';

import { EntitlementModule } from '../entitlements/entitlement.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ZoomModule } from '../providers/zoom/zoom.module.js';
import { MeetingProvisioningService } from './meeting-provisioning.service.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [EntitlementModule, ZoomModule, NotificationsModule],
  controllers: [SessionsController],
  providers: [SessionsService, MeetingProvisioningService],
  exports: [SessionsService, MeetingProvisioningService],
})
export class SessionsModule {}
