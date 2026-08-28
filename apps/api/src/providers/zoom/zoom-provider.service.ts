import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AppConfig } from '../../config/environment.js';

export interface ZoomMeetingRequest {
  topic: string;
  startTime: Date;
  durationMinutes: number;
}

export interface ZoomMeetingResult {
  providerMeetingId: string;
  joinUrl: string;
}

/**
 * The compact boundary Zoom sits behind (section D). TUBI Session remains
 * the domain object; everything Zoom-shaped — OAuth tokens, meeting
 * payloads, webhook signature schemes — stays inside this one class.
 *
 * When Zoom credentials are absent, every provider-calling method fails
 * closed with a readable, catchable error rather than silently
 * fabricating a meeting. The one exception is local development: outside
 * `production`, with no real credentials configured, a deterministic fake
 * meeting is returned so the rest of the school can be exercised without
 * a Zoom account — this path is explicitly logged and can never activate
 * in production (guarded on `NODE_ENV`, not merely on credential absence).
 */
@Injectable()
export class ZoomProviderService {
  private readonly logger = new Logger(ZoomProviderService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get('ZOOM_ACCOUNT_ID', { infer: true }) &&
      this.config.get('ZOOM_CLIENT_ID', { infer: true }) &&
      this.config.get('ZOOM_CLIENT_SECRET', { infer: true }),
    );
  }

  private isLocalDevFakeAllowed(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) !== 'production' && !this.isConfigured();
  }

  async createMeeting(request: ZoomMeetingRequest): Promise<ZoomMeetingResult> {
    if (this.isLocalDevFakeAllowed()) {
      this.logger.warn(
        'ZOOM_* credentials are not configured — using a local-development fake meeting. ' +
          'This path never activates when NODE_ENV=production.',
      );
      const fakeId = `local-dev-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      return {
        providerMeetingId: fakeId,
        joinUrl: `https://zoom.example.invalid/local-dev/${fakeId}`,
      };
    }

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Zoom integration is not configured (ZOOM_ACCOUNT_ID/ZOOM_CLIENT_ID/ZOOM_CLIENT_SECRET missing)',
      );
    }

    const token = await this.getAccessToken();
    const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: request.topic,
        type: 2, // scheduled meeting
        start_time: request.startTime.toISOString(),
        duration: request.durationMinutes,
        settings: { join_before_host: false, waiting_room: true },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ServiceUnavailableException(
        `Zoom meeting creation failed: ${response.status} ${body}`,
      );
    }

    const data = (await response.json()) as { id: number | string; join_url: string };
    return { providerMeetingId: String(data.id), joinUrl: data.join_url };
  }

  async deleteMeeting(providerMeetingId: string): Promise<void> {
    if (providerMeetingId.startsWith('local-dev-')) {
      return;
    }

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Zoom integration is not configured');
    }

    const token = await this.getAccessToken();
    const response = await fetch(
      `https://api.zoom.us/v2/meetings/${encodeURIComponent(providerMeetingId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );

    // 404 means Zoom already has no such meeting — deleting an
    // already-gone meeting is a no-op success, not an error.
    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      throw new ServiceUnavailableException(
        `Zoom meeting deletion failed: ${response.status} ${body}`,
      );
    }
  }

  /**
   * Verifies Zoom's `x-zm-signature` / `x-zm-request-timestamp` webhook
   * scheme: `v0=` + HMAC-SHA256(secret, `v0:{timestamp}:{rawBody}`).
   * Returns false (never throws) for any missing header, missing secret,
   * or mismatched signature — the caller always turns a false into 401.
   */
  verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
  ): boolean {
    const secret = this.config.get('ZOOM_WEBHOOK_SECRET_TOKEN', { infer: true });

    if (!secret || !signatureHeader || !timestampHeader) {
      return false;
    }

    const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestampHeader}:${rawBody}`).digest('hex')}`;

    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signatureHeader);

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  /** Zoom's URL-validation handshake, required once when a webhook
   * endpoint is registered. Computed from the same secret as signature
   * verification, never a separate credential. */
  computeUrlValidationResponse(plainToken: string): string {
    const secret = this.config.get('ZOOM_WEBHOOK_SECRET_TOKEN', { infer: true });

    if (!secret) {
      throw new ServiceUnavailableException('ZOOM_WEBHOOK_SECRET_TOKEN is not configured');
    }

    return createHmac('sha256', secret).update(plainToken).digest('hex');
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }

    const accountId = this.config.get('ZOOM_ACCOUNT_ID', { infer: true });
    const clientId = this.config.get('ZOOM_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('ZOOM_CLIENT_SECRET', { infer: true });
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      { method: 'POST', headers: { Authorization: `Basic ${basicAuth}` } },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new ServiceUnavailableException(
        `Zoom OAuth token request failed: ${response.status} ${body}`,
      );
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      value: data.access_token,
      // Refresh a minute early to avoid a request racing an expiring token.
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return this.cachedToken.value;
  }
}
