import { createHmac } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/environment.js';
import { PaystackProviderService } from './paystack-provider.service.js';

function buildConfig(secretKey?: string) {
  return {
    get: (key: string) => (key === 'PAYSTACK_SECRET_KEY' ? secretKey : undefined),
  } as unknown as ConfigService<AppConfig, true>;
}

describe('PaystackProviderService', () => {
  describe('isConfigured', () => {
    it('is false without a secret key', () => {
      expect(new PaystackProviderService(buildConfig()).isConfigured()).toBe(false);
    });

    it('is true with a secret key', () => {
      expect(new PaystackProviderService(buildConfig('sk_test_x')).isConfigured()).toBe(true);
    });
  });

  describe('verifyWebhookSignature', () => {
    const secret = 'sk_test_x';

    it('accepts a correctly computed HMAC-SHA512 signature', () => {
      const service = new PaystackProviderService(buildConfig(secret));
      const rawBody = '{"event":"charge.success"}';
      const expected = createHmac('sha512', secret).update(rawBody).digest('hex');

      expect(service.verifyWebhookSignature(rawBody, expected)).toBe(true);
    });

    it('rejects a tampered body against an unchanged signature', () => {
      const service = new PaystackProviderService(buildConfig(secret));
      const signature = createHmac('sha512', secret).update('{"amount":100}').digest('hex');

      expect(service.verifyWebhookSignature('{"amount":100000}', signature)).toBe(false);
    });

    it('rejects when unconfigured', () => {
      const service = new PaystackProviderService(buildConfig());
      expect(service.verifyWebhookSignature('{}', 'anything')).toBe(false);
    });
  });

  describe('parseWebhookEvent', () => {
    it('parses a charge.success event into a PAID outcome', () => {
      const service = new PaystackProviderService(buildConfig('sk'));
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref-1', amount: 15000, currency: 'ZAR', id: 999 },
      });

      const parsed = service.parseWebhookEvent(body);

      expect(parsed.outcome).toEqual({
        kind: 'PAID',
        providerReference: 'ref-1',
        amountMinor: 15000,
        currency: 'ZAR',
      });
      expect(parsed.externalEventId).toBe('charge.success:999');
    });

    it('parses a charge.failed event into a FAILED outcome', () => {
      const service = new PaystackProviderService(buildConfig('sk'));
      const body = JSON.stringify({
        event: 'charge.failed',
        data: { reference: 'ref-2', amount: 15000, currency: 'ZAR', id: 1000 },
      });

      expect(service.parseWebhookEvent(body).outcome).toEqual({
        kind: 'FAILED',
        providerReference: 'ref-2',
      });
    });

    it('ignores an unrecognised event type', () => {
      const service = new PaystackProviderService(buildConfig('sk'));
      const body = JSON.stringify({
        event: 'subscription.create',
        data: { reference: 'ref-3', amount: 0, currency: 'ZAR', id: 1 },
      });

      expect(service.parseWebhookEvent(body).outcome).toEqual({ kind: 'IGNORED' });
    });
  });
});
