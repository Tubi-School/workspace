import { UnauthorizedException } from '@nestjs/common';

import type { RawBodyRequest } from '../common/raw-body-request.js';
import type { WebhookIdempotencyService } from '../webhooks/webhook-idempotency.service.js';
import type { PaymentProvider } from './payment-provider.interface.js';
import { PaymentsWebhooksController } from './payments-webhooks.controller.js';
import type { PaymentsService } from './payments.service.js';

function buildRequest(rawBody: string, signature?: string): RawBodyRequest {
  return {
    rawBody: Buffer.from(rawBody),
    header: (name: string) =>
      name.toLowerCase() === 'x-paystack-signature' ? signature : undefined,
  } as unknown as RawBodyRequest;
}

describe('PaymentsWebhooksController', () => {
  let provider: { verifyWebhookSignature: jest.Mock; parseWebhookEvent: jest.Mock };
  let idempotency: { claim: jest.Mock; markProcessed: jest.Mock; markFailed: jest.Mock };
  let paymentsService: { confirmPayment: jest.Mock; failPayment: jest.Mock };
  let controller: PaymentsWebhooksController;

  beforeEach(() => {
    provider = { verifyWebhookSignature: jest.fn(), parseWebhookEvent: jest.fn() };
    idempotency = {
      claim: jest.fn().mockResolvedValue({ outcome: 'PROCEED', token: 'token-1' }),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    paymentsService = { confirmPayment: jest.fn(), failPayment: jest.fn() };
    controller = new PaymentsWebhooksController(
      provider as unknown as PaymentProvider,
      idempotency as unknown as WebhookIdempotencyService,
      paymentsService as unknown as PaymentsService,
    );
  });

  it('rejects a request with an invalid signature and never touches PaymentsService', async () => {
    provider.verifyWebhookSignature.mockReturnValue(false);

    await expect(controller.handle(buildRequest('{}', 'bad'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(paymentsService.confirmPayment).not.toHaveBeenCalled();
  });

  it('no-ops an already-processed redelivered webhook without confirming payment again', async () => {
    provider.verifyWebhookSignature.mockReturnValue(true);
    provider.parseWebhookEvent.mockReturnValue({
      externalEventId: 'charge.success:1',
      eventType: 'charge.success',
      outcome: { kind: 'PAID', providerReference: 'ref-1', amountMinor: 100, currency: 'ZAR' },
    });
    idempotency.claim.mockResolvedValue({ outcome: 'ALREADY_PROCESSED' });

    const result = await controller.handle(buildRequest('{}', 'ok'));

    expect(result).toEqual({ status: 'ok' });
    expect(paymentsService.confirmPayment).not.toHaveBeenCalled();
  });

  it('no-ops when another concurrent delivery already holds the processing claim', async () => {
    provider.verifyWebhookSignature.mockReturnValue(true);
    provider.parseWebhookEvent.mockReturnValue({
      externalEventId: 'charge.success:1',
      eventType: 'charge.success',
      outcome: { kind: 'PAID', providerReference: 'ref-1', amountMinor: 100, currency: 'ZAR' },
    });
    idempotency.claim.mockResolvedValue({ outcome: 'CLAIMED_BY_OTHER' });

    const result = await controller.handle(buildRequest('{}', 'ok'));

    expect(result).toEqual({ status: 'ok' });
    expect(paymentsService.confirmPayment).not.toHaveBeenCalled();
  });

  it('confirms payment for a claimed PAID event and marks it processed with the claim token', async () => {
    provider.verifyWebhookSignature.mockReturnValue(true);
    provider.parseWebhookEvent.mockReturnValue({
      externalEventId: 'charge.success:1',
      eventType: 'charge.success',
      outcome: { kind: 'PAID', providerReference: 'ref-1', amountMinor: 15000, currency: 'ZAR' },
    });

    await controller.handle(buildRequest('{}', 'ok'));

    expect(paymentsService.confirmPayment).toHaveBeenCalledWith('ref-1', 15000, 'ZAR');
    expect(idempotency.markProcessed).toHaveBeenCalledWith(
      'PAYMENT',
      'charge.success:1',
      'token-1',
    );
  });

  it('fails payment for a claimed FAILED event and marks it processed', async () => {
    provider.verifyWebhookSignature.mockReturnValue(true);
    provider.parseWebhookEvent.mockReturnValue({
      externalEventId: 'charge.failed:1',
      eventType: 'charge.failed',
      outcome: { kind: 'FAILED', providerReference: 'ref-1' },
    });

    await controller.handle(buildRequest('{}', 'ok'));

    expect(paymentsService.failPayment).toHaveBeenCalledWith('ref-1');
    expect(idempotency.markProcessed).toHaveBeenCalledWith('PAYMENT', 'charge.failed:1', 'token-1');
  });

  it('ignores an unrecognised event outcome, still marking it processed (never retried forever)', async () => {
    provider.verifyWebhookSignature.mockReturnValue(true);
    provider.parseWebhookEvent.mockReturnValue({
      externalEventId: 'subscription.create:1',
      eventType: 'subscription.create',
      outcome: { kind: 'IGNORED' },
    });

    await controller.handle(buildRequest('{}', 'ok'));

    expect(paymentsService.confirmPayment).not.toHaveBeenCalled();
    expect(paymentsService.failPayment).not.toHaveBeenCalled();
    expect(idempotency.markProcessed).toHaveBeenCalledWith(
      'PAYMENT',
      'subscription.create:1',
      'token-1',
    );
  });

  it('marks the event failed (fenced by claim token, never permanently poisoned) when confirmPayment throws, and rethrows', async () => {
    provider.verifyWebhookSignature.mockReturnValue(true);
    provider.parseWebhookEvent.mockReturnValue({
      externalEventId: 'charge.success:1',
      eventType: 'charge.success',
      outcome: { kind: 'PAID', providerReference: 'ref-1', amountMinor: 15000, currency: 'ZAR' },
    });
    paymentsService.confirmPayment.mockRejectedValue(new Error('transient failure'));

    await expect(controller.handle(buildRequest('{}', 'ok'))).rejects.toThrow('transient failure');

    expect(idempotency.markFailed).toHaveBeenCalledWith('PAYMENT', 'charge.success:1', 'token-1');
    expect(idempotency.markProcessed).not.toHaveBeenCalled();
  });
});
