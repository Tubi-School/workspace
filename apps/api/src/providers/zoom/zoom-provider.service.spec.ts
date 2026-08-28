import { createHmac } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/environment.js';
import { ZoomProviderService } from './zoom-provider.service.js';

function buildConfig(overrides: Partial<Record<string, unknown>> = {}) {
  const values: Record<string, unknown> = { NODE_ENV: 'test', ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService<AppConfig, true>;
}

describe('ZoomProviderService', () => {
  describe('isConfigured', () => {
    it('is false when any of the three Zoom credentials is missing', () => {
      const service = new ZoomProviderService(buildConfig({ ZOOM_ACCOUNT_ID: 'a' }));
      expect(service.isConfigured()).toBe(false);
    });

    it('is true when all three credentials are present', () => {
      const service = new ZoomProviderService(
        buildConfig({ ZOOM_ACCOUNT_ID: 'a', ZOOM_CLIENT_ID: 'b', ZOOM_CLIENT_SECRET: 'c' }),
      );
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('createMeeting — local dev fake gating', () => {
    it('returns a deterministic local fake meeting outside production when unconfigured', async () => {
      const service = new ZoomProviderService(buildConfig({ NODE_ENV: 'development' }));

      const result = await service.createMeeting({
        topic: 'x',
        startTime: new Date(),
        durationMinutes: 30,
      });

      expect(result.providerMeetingId).toMatch(/^local-dev-/);
      expect(result.joinUrl).toContain('local-dev');
    });

    it('throws (never fabricates a meeting) in production when unconfigured', async () => {
      const service = new ZoomProviderService(buildConfig({ NODE_ENV: 'production' }));

      await expect(
        service.createMeeting({ topic: 'x', startTime: new Date(), durationMinutes: 30 }),
      ).rejects.toThrow(/not configured/i);
    });
  });

  describe('verifyWebhookSignature', () => {
    const secret = 'test-webhook-secret';

    it('accepts a correctly computed v0 signature', () => {
      const service = new ZoomProviderService(buildConfig({ ZOOM_WEBHOOK_SECRET_TOKEN: secret }));
      const rawBody = '{"event":"test"}';
      const timestamp = '1700000000';
      const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;

      expect(service.verifyWebhookSignature(rawBody, expected, timestamp)).toBe(true);
    });

    it('rejects a mismatched signature', () => {
      const service = new ZoomProviderService(buildConfig({ ZOOM_WEBHOOK_SECRET_TOKEN: secret }));
      expect(service.verifyWebhookSignature('{}', 'v0=deadbeef', '1700000000')).toBe(false);
    });

    it('rejects when the secret is not configured', () => {
      const service = new ZoomProviderService(buildConfig({}));
      expect(service.verifyWebhookSignature('{}', 'v0=anything', '1700000000')).toBe(false);
    });

    it('rejects when the signature header is missing', () => {
      const service = new ZoomProviderService(buildConfig({ ZOOM_WEBHOOK_SECRET_TOKEN: secret }));
      expect(service.verifyWebhookSignature('{}', undefined, '1700000000')).toBe(false);
    });
  });
});
