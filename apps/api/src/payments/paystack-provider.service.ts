import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AppConfig } from '../config/environment.js';
import type {
  CheckoutInitRequest,
  CheckoutInitResult,
  ParsedPaymentWebhookEvent,
  PaymentProvider,
} from './payment-provider.interface.js';

/**
 * Paystack — the conventional choice for a South African ZAR launch
 * (native ZAR support, hosted checkout, HMAC-SHA512-signed webhooks). Kept
 * behind `PaymentProvider` so swapping or adding a provider later never
 * touches PaymentsService.
 */
@Injectable()
export class PaystackProviderService implements PaymentProvider {
  readonly name = 'PAYSTACK';

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    return Boolean(this.config.get('PAYSTACK_SECRET_KEY', { infer: true }));
  }

  async initializeCheckout(request: CheckoutInitRequest): Promise<CheckoutInitResult> {
    const secretKey = this.config.get('PAYSTACK_SECRET_KEY', { infer: true });

    if (!secretKey) {
      throw new ServiceUnavailableException(
        'Payments are not configured (PAYSTACK_SECRET_KEY missing)',
      );
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: request.email,
        amount: request.amountMinor,
        currency: request.currency,
        reference: request.providerReference,
        callback_url: request.callbackUrl,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ServiceUnavailableException(
        `Paystack checkout initialization failed: ${response.status} ${body}`,
      );
    }

    const data = (await response.json()) as { data: { authorization_url: string } };
    return { checkoutUrl: data.data.authorization_url };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    const secretKey = this.config.get('PAYSTACK_SECRET_KEY', { infer: true });

    if (!secretKey || !signatureHeader) {
      return false;
    }

    const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signatureHeader);

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  parseWebhookEvent(rawBody: string): ParsedPaymentWebhookEvent {
    const body = JSON.parse(rawBody) as {
      event: string;
      data: { reference: string; amount: number; currency: string; id: number | string };
    };

    const externalEventId = `${body.event}:${body.data.id}`;

    if (body.event === 'charge.success') {
      return {
        externalEventId,
        eventType: body.event,
        outcome: {
          kind: 'PAID',
          providerReference: body.data.reference,
          amountMinor: body.data.amount,
          currency: body.data.currency,
        },
      };
    }

    if (body.event === 'charge.failed') {
      return {
        externalEventId,
        eventType: body.event,
        outcome: { kind: 'FAILED', providerReference: body.data.reference },
      };
    }

    return { externalEventId, eventType: body.event, outcome: { kind: 'IGNORED' } };
  }
}
