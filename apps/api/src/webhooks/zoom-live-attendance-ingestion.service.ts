import { Injectable, Logger } from '@nestjs/common';

import { LiveAttendanceIntervalService } from '../attendance/live-attendance.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';
const PRISMA_NOT_FOUND_ERROR_CODE = 'P2025';

/**
 * Translates Zoom `meeting.participant_joined` / `meeting.participant_left`
 * webhook events into the existing, frozen LIVE attendance pipeline
 * (section H). This is deliberately the only file that knows Zoom's
 * participant-event shape — everything downstream of it is the same
 * `LiveAttendanceIntervalService.ingest` the Phase 2F design already built
 * and tested, completely unmodified.
 *
 * A `participant_joined` event opens a `LiveParticipantSession` row keyed
 * by (sessionId, providerParticipantId) — a duplicate/replayed join event
 * for the same connection is a no-op (unique constraint). A matching
 * `participant_left` event consumes that row (deletes it) and ingests the
 * now-complete [joinedAt, leftAt] interval; a `left` event with no open row
 * (a duplicate leave, or a join TUBI never saw) is logged and ignored
 * rather than guessed at.
 */
@Injectable()
export class ZoomLiveAttendanceIngestionService {
  private readonly logger = new Logger(ZoomLiveAttendanceIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly liveAttendanceIntervalService: LiveAttendanceIntervalService,
  ) {}

  async handleParticipantJoined(
    providerMeetingId: string,
    providerParticipantId: string,
    participantEmail: string | undefined,
    joinedAt: Date,
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { providerMeetingId } });
    if (!session) {
      this.logger.warn(`Ignoring participant_joined for unknown meeting ${providerMeetingId}`);
      return;
    }

    const learnerId = await this.resolveLearnerId(participantEmail);
    if (!learnerId) {
      this.logger.warn(
        `Ignoring participant_joined for meeting ${providerMeetingId}: no matching learner for participant`,
      );
      return;
    }

    try {
      await this.prisma.liveParticipantSession.create({
        data: { sessionId: session.id, learnerId, providerParticipantId, joinedAt },
      });
    } catch (error) {
      // Phase 4 external review Correction 7: only the EXPECTED
      // duplicate/replayed-join collision (the unique constraint on
      // (sessionId, providerParticipantId)) is a safe no-op. A connection
      // error, constraint violation on a different column, or any other
      // Prisma failure must propagate — swallowing it here would let the
      // webhook controller mark the event PROCESSED despite the join
      // never actually being recorded, silently losing attendance.
      if (!this.isUniqueConstraintViolation(error)) {
        throw error;
      }
    }
  }

  async handleParticipantLeft(
    providerMeetingId: string,
    providerParticipantId: string,
    leftAt: Date,
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { providerMeetingId } });
    if (!session) {
      this.logger.warn(`Ignoring participant_left for unknown meeting ${providerMeetingId}`);
      return;
    }

    const open = await this.prisma.liveParticipantSession.findUnique({
      where: {
        sessionId_providerParticipantId: { sessionId: session.id, providerParticipantId },
      },
    });

    if (!open) {
      this.logger.warn(
        `Ignoring participant_left for meeting ${providerMeetingId}: no open join recorded (duplicate leave or missed join)`,
      );
      return;
    }

    // Phase 4 external review Correction 1: ingest BEFORE consuming the
    // open join, not after. The original order deleted the
    // LiveParticipantSession row first — if `ingest` then failed or the
    // process crashed, a webhook retry would find no open join, log it as
    // "duplicate leave or missed join," and return successfully,
    // permanently losing genuine attendance. `ingest` is safe to call
    // twice with the exact same [joinedAt, leftAt] pair (frozen
    // LiveAttendanceIntervalService semantics: coverage is always
    // recomputed from the full merged interval set, so an identical
    // duplicate row contributes no extra coverage) — so a crash between
    // ingest succeeding and the delete below is also safe: the retry
    // re-ingests (a harmless no-op) and then successfully consumes the
    // still-open row.
    await this.liveAttendanceIntervalService.ingest(session.id, {
      learnerId: open.learnerId,
      joinedAt: open.joinedAt.toISOString(),
      leftAt: leftAt.toISOString(),
    });

    try {
      await this.prisma.liveParticipantSession.delete({ where: { id: open.id } });
    } catch (error) {
      // Already consumed by a concurrent/retried delivery — safe no-op,
      // since the attendance interval was already (idempotently) ingested
      // above either by this call or the one that got here first.
      if (!this.isRecordNotFound(error)) {
        throw error;
      }
    }
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
    );
  }

  private isRecordNotFound(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_NOT_FOUND_ERROR_CODE
    );
  }

  private async resolveLearnerId(email: string | undefined): Promise<string | null> {
    if (!email) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { learnerProfile: true },
    });

    return user?.learnerProfile?.id ?? null;
  }
}
