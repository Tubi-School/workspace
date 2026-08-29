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

  it('is not configured when only some SMTP settings are present', () => {
    const service = new EmailProviderService(
      buildConfig({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'mailer' }),
    );
    expect(service.isConfigured()).toBe(false);
  });

  it('is configured only when all required SMTP settings are present', () => {
    const service = new EmailProviderService(
      buildConfig({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_USER: 'mailer',
        SMTP_PASSWORD: 'password',
        SMTP_FROM_ADDRESS: 'no-reply@example.com',
      }),
    );
    expect(service.isConfigured()).toBe(true);
  });
});
