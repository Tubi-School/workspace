import { ConflictException, Injectable, Logger } from '@nestjs/common';

import { RecordingService } from '../attendance/recording.service.js';
import { SessionStatus } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';

const ZOOM_PROVIDER_NAME = 'ZOOM';

export interface ZoomRecordingCompletedPayload {
  providerMeetingId: string;
  providerRecordingId: string;
  /** Zoom's `share_url` — a provider-hosted playback page, never a raw
   * `download_url` carrying an embedded access token (section M). */
  shareUrl: string;
  totalSeconds: number;
}

/**
 * Ingests Zoom `recording.completed` webhooks (section I/J). TUBI's own
 * Session state machine stays authoritative: a recording arriving for a
 * CANCELED session is discarded (never resurrects it), and a recording
 * arriving while the session is still LIVE performs the ordinary,
 * already-valid LIVE -> ENDED transition (the real-world signal that the
 * class has, in fact, ended) rather than inventing a new state or
 * silently overwriting session status.
 */
@Injectable()
export class ZoomRecordingIngestionService {
  private readonly logger = new Logger(ZoomRecordingIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly recordingService: RecordingService,
    private readonly notifications: NotificationsService,
  ) {}

  async ingest(payload: ZoomRecordingCompletedPayload): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { providerMeetingId: payload.providerMeetingId },
    });

    if (!session) {
      this.logger.warn(
        `Ignoring recording.completed for unknown meeting ${payload.providerMeetingId}`,
      );
      return;
    }

    if (session.status === SessionStatus.CANCELED || session.status === SessionStatus.SCHEDULED) {
      this.logger.warn(
        `Ignoring recording.completed for session ${session.id} in status ${session.status}`,
      );
      return;
    }

    if (session.status === SessionStatus.LIVE) {
      try {
        await this.sessionsService.markEnded(session.id);
      } catch (error) {
        if (!(error instanceof ConflictException)) {
          throw error;
        }
        // Lost the race with an ADMIN/another webhook already ending it —
        // proceed to publish against the now-ENDED session.
      }
    }

    const result = await this.recordingService.publishFromProvider(session.id, {
      recordingUrl: payload.shareUrl,
      totalSeconds: payload.totalSeconds,
      availableFrom: new Date(),
      provider: ZOOM_PROVIDER_NAME,
      providerRecordingId: payload.providerRecordingId,
    });

    // Phase 4 external review Correction 9: only a genuinely NEW
    // publication notifies learners — a redelivered webhook finding the
    // recording already published (`created: false`) must never send a
    // second RECORDING_AVAILABLE notification.
    if (result?.created) {
      // Best-effort — the recording is already published above; a
      // notification failure must never cause this webhook to be marked
      // failed and retried purely over an unrelated outbox-write hiccup
      // (Phase 4 external review Correction 8).
      try {
        const course = await this.prisma.course.findUnique({ where: { id: session.courseId } });
        await this.notifications.enqueueForEntitledLearners(session.id, 'RECORDING_AVAILABLE', {
          courseTitle: course?.title ?? '',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Failed to enqueue RECORDING_AVAILABLE notification for session ${session.id}: ${message}`,
        );
      }
    }
  }
}
