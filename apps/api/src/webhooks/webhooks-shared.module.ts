import { Module } from '@nestjs/common';

import { WebhookIdempotencyService } from './webhook-idempotency.service.js';

/** The idempotency ledger shared by every provider webhook (Zoom, and the
 * payments module) — split into its own module so PaymentsModule does not
 * need to depend on the rest of the Zoom-specific webhooks wiring. */
@Module({
  providers: [WebhookIdempotencyService],
  exports: [WebhookIdempotencyService],
})
export class WebhooksSharedModule {}
