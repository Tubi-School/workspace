import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceService } from './attendance.service.js';
import type { CreateLiveIntervalDto } from './dto/create-live-interval.dto.js';
import {
  clipInterval,
  mergeIntervals,
  totalCoverage,
  type NumericInterval,
} from './interval-merge.util.js';
import { withLearnerSessionLock } from './learner-session-lock.util.js';

/**
 * Internal ingestion for LIVE participation — the seam a future Zoom
 * adapter attaches to (Part E of the Phase 2F brief). Every ingested
 * interval is clipped to the session's scheduled window before it is ever
 * summed, so time outside [startTime, endTime] never counts, and
 * overlapping/duplicate intervals never double-count because coverage is
 * always recomputed from the full merged set, not accumulated
 * incrementally.
 */
@Injectable()
export class LiveAttendanceIntervalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
  ) {}

  async ingest(sessionId: string, dto: CreateLiveIntervalDto): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const joinedAt = new Date(dto.joinedAt);
    const leftAt = new Date(dto.leftAt);

    if (joinedAt.getTime() >= leftAt.getTime()) {
      throw new BadRequestException('joinedAt must be strictly before leftAt');
    }

    await this.attendanceService.assertEntitled(sessionId, dto.learnerId);

    // The insert-reread-recompute-qualify sequence below must behave as one
    // consistent operation under concurrent submissions for the same
    // (sessionId, learnerId) pair — otherwise two racing ingest() calls
    // could each read the coverage set before the other's row is visible,
    // silently losing one interval's contribution to the merged coverage
    // total. A Postgres session-scoped advisory lock, held for the
    // duration of one `$transaction`, serializes concurrent ingestion for
    // the same learner+session without requiring any schema change:
    // requests for different learners/sessions never contend, and a
    // request for the same pair simply waits its turn. See
    // learner-session-lock.util.ts for the exact mechanism.
    await withLearnerSessionLock(this.prisma, sessionId, dto.learnerId, async (tx) => {
      await tx.liveAttendanceInterval.create({
        data: { sessionId, learnerId: dto.learnerId, joinedAt, leftAt },
      });

      const allIntervals = await tx.liveAttendanceInterval.findMany({
        where: { sessionId, learnerId: dto.learnerId },
      });

      const bounds: NumericInterval = {
        start: session.startTime.getTime(),
        end: session.endTime.getTime(),
      };
      const clipped = allIntervals
        .map((interval) =>
          clipInterval(
            { start: interval.joinedAt.getTime(), end: (interval.leftAt ?? new Date()).getTime() },
            bounds,
          ),
        )
        .filter((interval): interval is NumericInterval => interval !== null);

      const coverageMs = totalCoverage(mergeIntervals(clipped));
      const scheduledDurationMs = session.endTime.getTime() - session.startTime.getTime();

      await this.attendanceService.qualifyLive(
        sessionId,
        dto.learnerId,
        coverageMs,
        scheduledDurationMs,
        leftAt,
        tx,
      );
    });
  }
}
