import { Controller, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';

import type { RawBodyRequest } from '../common/raw-body-request.js';
import { WebhookIdempotencyService } from '../webhooks/webhook-idempotency.service.js';
import type { PaymentProvider } from './payment-provider.interface.js';
import { PAYMENT_PROVIDER } from './payments.constants.js';
import { PaymentsService } from './payments.service.js';

/**
 * The single verified confirmation path SubscriptionAccess is ever granted
 * through (section L). Every request is signature-verified before its body
 * is trusted, then claimed against the shared idempotency ledger before
 * `PaymentsService` is ever called — a redelivered webhook always responds
 * 200 without granting a second access.
 */
@Controller('webhooks/payments')
export class PaymentsWebhooksController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Post()
  async handle(@Req() req: RawBodyRequest): Promise<{ status: string }> {
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    const signature = req.header('x-paystack-signature');

    if (!this.provider.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid payment webhook signature');
    }

    const event = this.provider.parseWebhookEvent(rawBody);
    const claim = await this.idempotency.claim('PAYMENT', event.externalEventId, event.eventType);

    if (claim.outcome !== 'PROCEED') {
      // ALREADY_PROCESSED or CLAIMED_BY_OTHER — never applies the business
      // effect twice (Phase 4 external review Correction 1).
      return { status: 'ok' };
    }

    try {
      if (event.outcome.kind === 'PAID') {
        await this.paymentsService.confirmPayment(
          event.outcome.providerReference,
          event.outcome.amountMinor,
          event.outcome.currency,
        );
      } else if (event.outcome.kind === 'FAILED') {
        await this.paymentsService.failPayment(event.outcome.providerReference);
      }
      await this.idempotency.markProcessed('PAYMENT', event.externalEventId, claim.token);
    } catch (error) {
      // Fenced by claim.token (Correction 2): a no-op if another worker
      // has since reclaimed this event.
      await this.idempotency.markFailed('PAYMENT', event.externalEventId, claim.token);
      throw error;
    }

    return { status: 'ok' };
  }
}
