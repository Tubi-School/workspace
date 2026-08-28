import type { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/environment.js';
import { EmailProviderService } from './email-provider.service.js';

function buildConfig(overrides: Partial<Record<string, unknown>> = {}) {
  const values: Record<string, unknown> = { ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService<AppConfig, true>;
}

describe('EmailProviderService', () => {
  it('is unconfigured without SMTP_HOST', () => {
    const service = new EmailProviderService(buildConfig());
    expect(service.isConfigured()).toBe(false);
  });

  it('rejects send() with a readable error rather than fabricating delivery', async () => {
    const service = new EmailProviderService(buildConfig());
    await expect(service.send('a@b.com', 'subject', 'text')).rejects.toThrow(/not configured/i);
  });

  it('is configured once SMTP_HOST is present', () => {
    const service = new EmailProviderService(buildConfig({ SMTP_HOST: 'smtp.example.com' }));
    expect(service.isConfigured()).toBe(true);
  });
});
