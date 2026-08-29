import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ZoomModule } from '../providers/zoom/zoom.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';

@Module({
  imports: [ZoomModule, PaymentsModule, NotificationsModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
