import { Module } from '@nestjs/common';

import { SubscriptionAccessController } from './subscription-access.controller.js';
import { SubscriptionAccessService } from './subscription-access.service.js';

@Module({
  controllers: [SubscriptionAccessController],
  providers: [SubscriptionAccessService],
  exports: [SubscriptionAccessService],
})
export class SubscriptionAccessModule {}
