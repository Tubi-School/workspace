import { Module } from '@nestjs/common';

import { LearnerPortalModule } from '../learner-portal/learner-portal.module.js';
import { OfferingsModule } from '../offerings/offerings.module.js';
import { SubscriptionAccessModule } from '../subscription-access/subscription-access.module.js';
import { WebhooksSharedModule } from '../webhooks/webhooks-shared.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsWebhooksController } from './payments-webhooks.controller.js';
import { PAYMENT_PROVIDER } from './payments.constants.js';
import { PaymentsService } from './payments.service.js';
import { PaystackProviderService } from './paystack-provider.service.js';

@Module({
  imports: [SubscriptionAccessModule, LearnerPortalModule, OfferingsModule, WebhooksSharedModule],
  controllers: [PaymentsController, PaymentsWebhooksController],
  providers: [
    PaystackProviderService,
    { provide: PAYMENT_PROVIDER, useExisting: PaystackProviderService },
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
