import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma, SessionStatus, type SessionRecording } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PublishRecordingDto } from './dto/publish-recording.dto.js';

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/**
 * Publishing a recording only attaches the playback resource — it never,
 * by itself, marks anyone PRESENT (founder ruling, Part F). Attendance
 * only follows from genuine WatchedInterval coverage, evaluated
 * separately by WatchedIntervalService.
 */
@Injectable()
export class RecordingService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(sessionId: string, dto: PublishRecordingDto): Promise<SessionRecording> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    if (session.status !== SessionStatus.ENDED) {
      throw new ConflictException(
        `Session ${sessionId} is ${session.status}; recordings may only be published for ENDED sessions`,
      );
    }

    try {
      return await this.prisma.sessionRecording.create({
        data: {
          sessionId,
          recordingUrl: dto.recordingUrl,
          availableFrom: dto.availableFrom !== undefined ? new Date(dto.availableFrom) : new Date(),
          totalSeconds: dto.totalSeconds,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
      ) {
        throw new ConflictException(`Session ${sessionId} already has a published recording`);
      }
      throw error;
    }
  }

  /**
   * Automated counterpart to `publish` for provider recording-completion
   * webhooks (section I). Same "ENDED sessions only" invariant, but
   * idempotent-by-nature rather than erroring on a second call for the
   * same session: a duplicate/replayed provider event finds the recording
   * already published and is treated as a no-op success, since the
   * webhook layer's own idempotency ledger (ProviderWebhookEvent) is not
   * guaranteed to be the only thing that can redeliver an event.
   *
   * Phase 4 external review Correction 9: returns `{ recording, created }`
   * rather than the bare recording — a caller (specifically
   * `ZoomRecordingIngestionService`) must be able to tell "this call
   * genuinely created the row" apart from "this session already had one,"
   * so it enqueues a RECORDING_AVAILABLE notification exactly once, not on
   * every redelivered webhook.
   *
   * Also distinguishes the two different unique-constraint conflicts a
   * `create` here can hit:
   *   - `sessionId` already has a row: this SESSION was already
   *     published (by an earlier delivery of this exact event, or by a
   *     manual ADMIN publish that beat the webhook) — a safe idempotent
   *     no-op regardless of whether `providerRecordingId` matches, since
   *     `SessionRecording.sessionId` is frozen one-per-session.
   *   - `sessionId` is free but the conflict was on `providerRecordingId`
   *     instead: this Zoom recording is already attached to a DIFFERENT
   *     session — a genuine data inconsistency, never silently treated as
   *     a successful publish of the current session. This is re-thrown so
   *     the webhook is marked failed rather than acknowledged.
   */
  async publishFromProvider(
    sessionId: string,
    data: {
      recordingUrl: string;
      totalSeconds: number;
      availableFrom: Date;
      provider: string;
      providerRecordingId: string;
    },
  ): Promise<{ recording: SessionRecording; created: boolean } | null> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    if (!session || session.status !== SessionStatus.ENDED) {
      return null;
    }

    try {
      const recording = await this.prisma.sessionRecording.create({
        data: {
          sessionId,
          recordingUrl: data.recordingUrl,
          availableFrom: data.availableFrom,
          totalSeconds: data.totalSeconds,
          provider: data.provider,
          providerRecordingId: data.providerRecordingId,
        },
      });
      return { recording, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
      ) {
        const existing = await this.prisma.sessionRecording.findUnique({ where: { sessionId } });
        if (existing) {
          // This session already has a recording — idempotent no-op.
          return { recording: existing, created: false };
        }
        // sessionId was free; the conflict was on providerRecordingId
        // belonging to a different session. Never silently claim success.
        throw error;
      }
      throw error;
    }
  }

  async findForSession(sessionId: string): Promise<SessionRecording> {
    const recording = await this.prisma.sessionRecording.findUnique({ where: { sessionId } });

    if (!recording) {
      throw new NotFoundException(`Session ${sessionId} has no published recording`);
    }

    return recording;
  }
}
