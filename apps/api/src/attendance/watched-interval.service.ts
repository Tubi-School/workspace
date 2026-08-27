import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { SessionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceService } from './attendance.service.js';
import type { CreateWatchedIntervalDto } from './dto/create-watched-interval.dto.js';
import { RecordingService } from './recording.service.js';
import { mergeIntervals, totalCoverage } from './interval-merge.util.js';
import { withLearnerSessionLock } from './learner-session-lock.util.js';

/**
 * Learner-facing RECORDED playback ingestion (Part G). Never accepts a
 * client-reported percentage — only raw played ranges, which are merged
 * against everything previously reported before coverage is recomputed
 * from scratch, so skipping ahead always leaves the skipped span
 * genuinely uncovered and re-watching a span never inflates the total.
 */
@Injectable()
export class WatchedIntervalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly recordingService: RecordingService,
  ) {}

  async ingest(sessionId: string, learnerId: string, dto: CreateWatchedIntervalDto): Promise<void> {
    if (dto.startSecond >= dto.endSecond) {
      throw new BadRequestException('startSecond must be strictly before endSecond');
    }

    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    // A canceled session produces no AttendanceRecord rows (frozen design
    // section F) and must never have its historical entitlement/attendance
    // state mutated by late-arriving participation evidence. A missing
    // session is left to the recording lookup below, which produces the
    // usual 404 — a session that does not exist cannot have a recording
    // either, given the FK relationship.
    if (session?.status === SessionStatus.CANCELED) {
      throw new ConflictException(
        `Session ${sessionId} is CANCELED; attendance cannot be recorded`,
      );
    }

    await this.attendanceService.assertEntitled(sessionId, learnerId);

    const recording = await this.recordingService.findForSession(sessionId);

    if (dto.startSecond < 0 || dto.endSecond > recording.totalSeconds) {
      throw new BadRequestException(
        `Interval [${dto.startSecond}, ${dto.endSecond}] falls outside the recording's duration (0-${recording.totalSeconds})`,
      );
    }

    // See learner-session-lock.util.ts: serializes the create-reread-
    // recompute-qualify sequence for this (sessionId, learnerId) pair so
    // concurrent submissions can never lose coverage.
    await withLearnerSessionLock(this.prisma, sessionId, learnerId, async (tx) => {
      await tx.watchedInterval.create({
        data: {
          sessionRecordingId: recording.id,
          learnerId,
          startSecond: dto.startSecond,
          endSecond: dto.endSecond,
        },
      });

      const allIntervals = await tx.watchedInterval.findMany({
        where: { sessionRecordingId: recording.id, learnerId },
      });

      const coverageSeconds = totalCoverage(
        mergeIntervals(
          allIntervals.map((interval) => ({
            start: interval.startSecond,
            end: interval.endSecond,
          })),
        ),
      );

      await this.attendanceService.qualifyRecorded(
        sessionId,
        learnerId,
        coverageSeconds,
        recording.totalSeconds,
        new Date(),
        tx,
      );
    });
  }
}
