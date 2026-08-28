import { Controller, Post, Req, UnauthorizedException } from '@nestjs/common';

import type { RawBodyRequest } from '../common/raw-body-request.js';
import { ZoomProviderService } from '../providers/zoom/zoom-provider.service.js';
import { WebhookIdempotencyService } from './webhook-idempotency.service.js';
import { ZoomLiveAttendanceIngestionService } from './zoom-live-attendance-ingestion.service.js';
import { ZoomRecordingIngestionService } from './zoom-recording-ingestion.service.js';

const ZOOM_PROVIDER = 'ZOOM';

interface ZoomWebhookBody {
  event: string;
  event_ts?: number;
  payload: {
    plainToken?: string;
    account_id?: string;
    object?: {
      id?: string | number;
      uuid?: string;
      duration?: number;
      participant?: {
        id?: string;
        user_id?: string;
        email?: string;
        join_time?: string;
        leave_time?: string;
      };
      recording_files?: Array<{
        id?: string;
        share_url?: string;
        recording_type?: string;
        recording_end?: string;
        recording_start?: string;
      }>;
    };
  };
}

/**
 * Zoom's single webhook entry point (section D/I). Every request is
 * verified before any parsing of business meaning; every real event is
 * claimed against the idempotency ledger before it does any work, so a
 * redelivered webhook is always a safe no-op rather than double-processed.
 * This controller is deliberately thin — all Zoom-shaped translation lives
 * in ZoomLiveAttendanceIngestionService / ZoomRecordingIngestionService.
 */
@Controller('webhooks/zoom')
export class ZoomWebhooksController {
  constructor(
    private readonly zoom: ZoomProviderService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly liveAttendance: ZoomLiveAttendanceIngestionService,
    private readonly recording: ZoomRecordingIngestionService,
  ) {}

  @Post()
  async handle(
    @Req() req: RawBodyRequest,
  ): Promise<{ status: string } | { plainToken: string; encryptedToken: string }> {
    const body = req.body as ZoomWebhookBody;

    // Zoom's one-time endpoint-registration handshake carries no
    // signature and must be answered immediately with the HMAC of the
    // supplied plainToken.
    if (body.event === 'endpoint.url_validation') {
      const plainToken = body.payload.plainToken ?? '';
      return { plainToken, encryptedToken: this.zoom.computeUrlValidationResponse(plainToken) };
    }

    const rawBody = req.rawBody?.toString('utf8') ?? '';
    const signature = req.header('x-zm-signature');
    const timestamp = req.header('x-zm-request-timestamp');

    if (!this.zoom.verifyWebhookSignature(rawBody, signature, timestamp)) {
      throw new UnauthorizedException('Invalid Zoom webhook signature');
    }

    const externalEventId = this.buildEventId(body);
    const claim = await this.idempotency.claim(ZOOM_PROVIDER, externalEventId, body.event);

    if (claim.outcome !== 'PROCEED') {
      // ALREADY_PROCESSED (a redelivered, already-completed event) or
      // CLAIMED_BY_OTHER (a concurrent delivery is currently applying it)
      // — either way, this delivery must not apply the business effect
      // itself (Phase 4 external review Correction 1).
      return { status: 'ok' };
    }

    try {
      await this.route(body);
      await this.idempotency.markProcessed(ZOOM_PROVIDER, externalEventId, claim.token);
    } catch (error) {
      // Never permanently poisons the event — the next delivery/retry can
      // reclaim and complete it immediately. Fenced by claim.token
      // (Correction 2): a no-op if another worker has since reclaimed
      // this event.
      await this.idempotency.markFailed(ZOOM_PROVIDER, externalEventId, claim.token);
      throw error;
    }

    return { status: 'ok' };
  }

  private async route(body: ZoomWebhookBody): Promise<void> {
    const object = body.payload.object;
    if (!object?.id) {
      return;
    }
    const providerMeetingId = String(object.id);

    switch (body.event) {
      case 'meeting.participant_joined': {
        const participant = object.participant;
        if (!participant?.id || !participant.join_time) return;
        await this.liveAttendance.handleParticipantJoined(
          providerMeetingId,
          participant.id,
          participant.email,
          new Date(participant.join_time),
        );
        return;
      }
      case 'meeting.participant_left': {
        const participant = object.participant;
        if (!participant?.id || !participant.leave_time) return;
        await this.liveAttendance.handleParticipantLeft(
          providerMeetingId,
          participant.id,
          new Date(participant.leave_time),
        );
        return;
      }
      case 'recording.completed': {
        const files = object.recording_files ?? [];
        const primary =
          files.find((file) => file.recording_type === 'shared_screen_with_speaker_view') ??
          files[0];
        if (!primary?.share_url || !primary.id) return;

        const totalSeconds =
          primary.recording_start && primary.recording_end
            ? Math.max(
                0,
                Math.round(
                  (new Date(primary.recording_end).getTime() -
                    new Date(primary.recording_start).getTime()) /
                    1000,
                ),
              )
            : Math.max(0, (object.duration ?? 0) * 60);

        await this.recording.ingest({
          providerMeetingId,
          providerRecordingId: primary.id,
          shareUrl: primary.share_url,
          totalSeconds,
        });
        return;
      }
      default:
        // Any other subscribed-but-unhandled Zoom event is acknowledged
        // and ignored — an unrecognised event type must never surface as
        // a webhook failure to Zoom.
        return;
    }
  }

  private buildEventId(body: ZoomWebhookBody): string {
    const object = body.payload.object;
    const discriminator =
      object?.participant?.id ??
      object?.recording_files?.[0]?.id ??
      object?.uuid ??
      String(object?.id ?? '');
    return `${body.event}:${object?.id ?? ''}:${discriminator}:${body.event_ts ?? ''}`;
  }
}
