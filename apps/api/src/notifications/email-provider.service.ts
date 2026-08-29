import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

import type { AppConfig } from '../config/environment.js';

/**
 * The one place SMTP details are known (section N — email first, other
 * channels added later without touching school-domain services). Missing
 * configuration is an explicit, permanent "unconfigured" state — send()
 * throws a readable error rather than fabricating delivery, and the
 * dispatch scheduler records that error on the outbox item.
 */
@Injectable()
export class EmailProviderService {
  private readonly logger = new Logger(EmailProviderService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get('SMTP_HOST', { infer: true }) &&
      this.config.get('SMTP_PORT', { infer: true }) &&
      this.config.get('SMTP_USER', { infer: true }) &&
      this.config.get('SMTP_PASSWORD', { infer: true }) &&
      this.config.get('SMTP_FROM_ADDRESS', { infer: true }),
    );
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Email delivery is not configured (SMTP settings incomplete)');
    }

    const transporter = this.getTransporter();
    const from = this.config.get('SMTP_FROM_ADDRESS', { infer: true })!;

    await transporter.sendMail({ from, to, subject, text });
  }

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    this.transporter = createTransport({
      host: this.config.get('SMTP_HOST', { infer: true }),
      port: this.config.get('SMTP_PORT', { infer: true }),
      auth: {
        user: this.config.get('SMTP_USER', { infer: true }),
        pass: this.config.get('SMTP_PASSWORD', { infer: true }),
      },
    });
    this.logger.log('SMTP transporter initialized');
    return this.transporter;
  }
}
