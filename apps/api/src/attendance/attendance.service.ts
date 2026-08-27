import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import {
  AttendanceStatus,
  CompletionMode,
  DeliveryMode,
  Prisma,
  type AttendanceRecord,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Either the top-level PrismaService or an in-flight `$transaction`
 * client — lets qualification run inside a caller-owned transaction
 * (interval ingestion) without duplicating this logic. */
type Db = PrismaService | Prisma.TransactionClient;
import type { OverrideAttendanceDto } from './dto/override-attendance.dto.js';
import {
  clipInterval,
  mergeIntervals,
  totalCoverage,
  type NumericInterval,
} from './interval-merge.util.js';

export interface CoverageSummary {
  liveCoverageMs: number;
  recordedCoverageSeconds: number | null;
}

const attendanceRecordInclude = {
  learner: {
    select: { id: true, user: { select: { id: true, email: true, fullName: true } } },
  },
} as const;

export type AttendanceRecordWithLearner = AttendanceRecord & {
  learner: { id: string; user: { id: string; email: string; fullName: string } };
};

/**
 * The core of the Phase 2F attendance engine: effective-cutoff resolution,
 * LIVE/RECORDED qualification, absence finalization, manual override, and
 * reads. LiveAttendanceIntervalService and WatchedIntervalService (interval
 * ingestion) call into this for qualification; they own no attendance-state
 * logic themselves.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws if the learner was never entitled to this session — the only
   * gate participation-ingestion and self-service reads need. */
  async assertEntitled(sessionId: string, learnerId: string): Promise<void> {
    const snapshot = await this.prisma.sessionEntitlementSnapshot.findUnique({
      where: { sessionId_learnerId: { sessionId, learnerId } },
    });

    if (!snapshot || !snapshot.wasEntitled) {
      throw new ForbiddenException(`Learner ${learnerId} is not entitled to session ${sessionId}`);
    }
  }

  /**
   * Resolves the DeliveryMode the learner's own historical entitlement
   * grants for this session — read from the SessionEntitlementSnapshot's
   * own `subscriptionAccess.offering`, never from the learner's current
   * live subscription, so a later plan change cannot retroactively change
   * what a session already entitled a learner to. Assumes the caller has
   * already confirmed entitlement (assertEntitled).
   *
   * FAILS CLOSED (Phase 2G Correction 3): returns `null` — never a
   * default DeliveryMode — when the snapshot has no linked
   * SubscriptionAccess/Offering to read a mode from. This should not
   * occur for any snapshot the current entitlement engine writes, but a
   * missing or inconsistent entitlement-origin link is exactly the kind
   * of authorization-relevant data that must never be silently upgraded
   * to a permissive default. Every caller of this method is required to
   * treat `null` as "no LIVE privilege" — see assertLiveDeliveryModeAllowed
   * and LearnerPortalService's redaction logic.
   */
  private async resolvePermittedDeliveryMode(
    sessionId: string,
    learnerId: string,
    db: Db = this.prisma,
  ): Promise<DeliveryMode | null> {
    const snapshot = await db.sessionEntitlementSnapshot.findUnique({
      where: { sessionId_learnerId: { sessionId, learnerId } },
      include: { subscriptionAccess: { include: { offering: true } } },
    });

    return snapshot?.subscriptionAccess?.offering.deliveryMode ?? null;
  }

  /**
   * Enforces DeliveryMode at the point of LIVE participation: a learner
   * entitled only through a RECORDED_ONLY offering — or whose
   * entitlement-origin data cannot be resolved at all — must not gain
   * learner-facing LIVE access merely because the session also has a
   * meeting URL. LIVE access requires AFFIRMATIVE evidence of
   * LIVE_AND_RECORDED; anything else (RECORDED_ONLY, or null/unresolved)
   * denies it. RECORDED access is never gated the same way — both
   * DeliveryMode values include recorded access, so there is no
   * "LIVE_ONLY" case in the frozen enum that would need a symmetric
   * check on the recorded path.
   */
  async assertLiveDeliveryModeAllowed(
    sessionId: string,
    learnerId: string,
    db: Db = this.prisma,
  ): Promise<void> {
    const deliveryMode = await this.resolvePermittedDeliveryMode(sessionId, learnerId, db);

    if (deliveryMode !== DeliveryMode.LIVE_AND_RECORDED) {
      throw new ForbiddenException(
        `Learner ${learnerId} is not entitled to LIVE attendance on session ${sessionId}`,
      );
    }
  }

  /** Throws 403 unless the caller's TeacherProfile is assigned (any role —
   * PRIMARY/ASSISTANT/SUBSTITUTE) to this session. This is the scoping rule
   * that stops a TEACHER from reading attendance for a session they have
   * no operational relationship to (Part K). */
  async assertTeacherAssignedToSession(teacherUserId: string, sessionId: string): Promise<void> {
    const teacherProfile = await this.prisma.teacherProfile.findUnique({
      where: { userId: teacherUserId },
    });

    if (!teacherProfile) {
      throw new ForbiddenException('No teacher profile is associated with this account');
    }

    const assignment = await this.prisma.sessionTeacher.findUnique({
      where: { sessionId_teacherId: { sessionId, teacherId: teacherProfile.id } },
    });

    if (!assignment) {
      throw new ForbiddenException(`You are not assigned to session ${sessionId}`);
    }
  }

  /**
   * Resolves the deadline that actually applies to one learner on one
   * session: a learner-specific AttendanceWindowException, if one exists,
   * always wins outright over a session-wide one — this is the explicit
   * precedence the frozen design states (section G/K), not a "pick the
   * latest of all applicable values" comparison. Falls back to the
   * session's own normal cutoff when no exception exists. When more than
   * one exception exists at the same scope (a corrected/superseding grant),
   * the most recently created one is authoritative — exceptions are an
   * append-only audit log, never edited in place.
   */
  async getEffectiveCutoff(
    sessionId: string,
    learnerId: string,
    db: Db = this.prisma,
  ): Promise<Date> {
    const session = await db.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { attendanceCutoffAt: true },
    });

    const learnerException = await db.attendanceWindowException.findFirst({
      where: { sessionId, learnerId },
      orderBy: { createdAt: 'desc' },
    });
    if (learnerException) {
      return learnerException.extendedCutoffAt;
    }

    const sessionWideException = await db.attendanceWindowException.findFirst({
      where: { sessionId, learnerId: null },
      orderBy: { createdAt: 'desc' },
    });
    if (sessionWideException) {
      return sessionWideException.extendedCutoffAt;
    }

    return session.attendanceCutoffAt;
  }

  /** Called by LiveAttendanceIntervalService after every ingested interval
   * with the learner's current cumulative clipped coverage. A no-op unless
   * coverage has just crossed the 50% threshold and the record is still
   * PENDING. `db` lets the ingestion caller run this inside its own
   * transaction so the create-reread-qualify sequence stays atomic under
   * concurrent submissions for the same learner+session. */
  async qualifyLive(
    sessionId: string,
    learnerId: string,
    coverageMs: number,
    scheduledDurationMs: number,
    qualifiedAt: Date,
    db: Db = this.prisma,
  ): Promise<void> {
    if (coverageMs < scheduledDurationMs * 0.5) {
      return;
    }
    await this.markPresentIfPending(sessionId, learnerId, CompletionMode.LIVE, qualifiedAt, db);
  }

  /** Called by WatchedIntervalService after every ingested interval.
   * Genuine 100% coverage required — no tolerance beyond exact integer
   * seconds, since the schema already stores whole seconds only. */
  async qualifyRecorded(
    sessionId: string,
    learnerId: string,
    coverageSeconds: number,
    totalSeconds: number,
    qualifiedAt: Date,
    db: Db = this.prisma,
  ): Promise<void> {
    if (coverageSeconds < totalSeconds) {
      return;
    }
    await this.markPresentIfPending(sessionId, learnerId, CompletionMode.RECORDED, qualifiedAt, db);
  }

  private async markPresentIfPending(
    sessionId: string,
    learnerId: string,
    mode: CompletionMode,
    qualifiedAt: Date,
    db: Db = this.prisma,
  ): Promise<void> {
    // A learner with no AttendanceRecord was never entitled — ingestion
    // callers already assert entitlement before reaching here, but this
    // stays a no-op rather than an error so it is safe to call speculatively.
    const effectiveCutoff = await this.getEffectiveCutoff(sessionId, learnerId, db);

    if (qualifiedAt.getTime() > effectiveCutoff.getTime()) {
      // Genuine completion, but after the deadline: not ordinary
      // attendance. The record is left PENDING; the finalizer (Part I)
      // will move it to ABSENT once its cutoff has passed, exactly as if
      // nothing had been watched at all.
      return;
    }

    // `updateMany` with a `status: PENDING` guard, rather than a plain
    // `update`, is what makes this safe under concurrent qualification
    // attempts (e.g. two ingested intervals racing) and guarantees PRESENT
    // is never downgraded or re-timestamped once set.
    await db.attendanceRecord.updateMany({
      where: { sessionId, learnerId, status: AttendanceStatus.PENDING },
      data: { status: AttendanceStatus.PRESENT, completionMode: mode, completedAt: qualifiedAt },
    });
  }

  /**
   * Moves every still-PENDING AttendanceRecord whose effective cutoff has
   * passed to ABSENT. Idempotent and safe to call repeatedly or
   * concurrently: the `status: PENDING` guard on the update means a record
   * already finalized (by this call or a concurrent one) or already
   * PRESENT is never touched again.
   */
  async finalizeDueRecords(): Promise<{ finalizedCount: number }> {
    const duePending = await this.prisma.attendanceRecord.findMany({
      where: { status: AttendanceStatus.PENDING },
      select: { sessionId: true, learnerId: true },
    });

    const now = new Date();
    let finalizedCount = 0;

    for (const { sessionId, learnerId } of duePending) {
      const effectiveCutoff = await this.getEffectiveCutoff(sessionId, learnerId);

      if (now.getTime() > effectiveCutoff.getTime()) {
        const result = await this.prisma.attendanceRecord.updateMany({
          where: { sessionId, learnerId, status: AttendanceStatus.PENDING },
          data: { status: AttendanceStatus.ABSENT, completionMode: null, completedAt: null },
        });
        finalizedCount += result.count;
      }
    }

    return { finalizedCount };
  }

  /**
   * Manual, exceptional attendance correction (founder ruling — never a
   * normal register). Writes an AttendanceOverride audit row and applies
   * the new status in the same transaction; never touches the underlying
   * LiveAttendanceInterval/WatchedInterval evidence rows — the override and
   * the raw participation evidence remain independently inspectable.
   */
  async override(
    attendanceRecordId: string,
    dto: OverrideAttendanceDto,
    performedByUserId: string,
  ): Promise<AttendanceRecord> {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id: attendanceRecordId },
    });

    if (!record) {
      throw new NotFoundException(`Attendance record ${attendanceRecordId} not found`);
    }

    const isPresent = dto.newStatus === AttendanceStatus.PRESENT;

    return this.prisma.$transaction(async (tx) => {
      await tx.attendanceOverride.create({
        data: {
          attendanceRecordId,
          previousStatus: record.status,
          newStatus: dto.newStatus,
          performedByUserId,
          reason: dto.reason,
        },
      });

      return tx.attendanceRecord.update({
        where: { id: attendanceRecordId },
        data: {
          status: dto.newStatus,
          // Same nullable-together invariant AttendanceRecord enforces
          // everywhere else: populated only for PRESENT, null otherwise.
          completionMode: isPresent ? (dto.completionMode ?? null) : null,
          completedAt:
            isPresent && dto.completedAt !== undefined ? new Date(dto.completedAt) : null,
        },
      });
    });
  }

  async getSessionAttendance(sessionId: string): Promise<AttendanceRecordWithLearner[]> {
    return this.prisma.attendanceRecord.findMany({
      where: { sessionId },
      include: attendanceRecordInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getLearnerAttendanceHistory(learnerId: string): Promise<AttendanceRecord[]> {
    return this.prisma.attendanceRecord.findMany({
      where: { learnerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOneAttendanceRecord(sessionId: string, learnerId: string): Promise<AttendanceRecord> {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { sessionId_learnerId: { sessionId, learnerId } },
    });

    if (!record) {
      throw new NotFoundException(
        `No attendance record for learner ${learnerId} on session ${sessionId}`,
      );
    }

    return record;
  }

  /** Accumulated LIVE coverage (clipped to the scheduled session window)
   * and RECORDED coverage (against the published recording, if any) for
   * one learner — the "coverage" figures Part K's reads expose alongside
   * status/completionMode/completedAt. */
  async getCoverageSummary(sessionId: string, learnerId: string): Promise<CoverageSummary> {
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { startTime: true, endTime: true },
    });

    const liveIntervals = await this.prisma.liveAttendanceInterval.findMany({
      where: { sessionId, learnerId },
    });
    const bounds: NumericInterval = {
      start: session.startTime.getTime(),
      end: session.endTime.getTime(),
    };
    const clippedLive = liveIntervals
      .map((interval) =>
        clipInterval(
          { start: interval.joinedAt.getTime(), end: (interval.leftAt ?? new Date()).getTime() },
          bounds,
        ),
      )
      .filter((interval): interval is NumericInterval => interval !== null);
    const liveCoverageMs = totalCoverage(mergeIntervals(clippedLive));

    const recording = await this.prisma.sessionRecording.findUnique({ where: { sessionId } });
    let recordedCoverageSeconds: number | null = null;

    if (recording) {
      const watched = await this.prisma.watchedInterval.findMany({
        where: { sessionRecordingId: recording.id, learnerId },
      });
      recordedCoverageSeconds = totalCoverage(
        mergeIntervals(
          watched.map((interval) => ({ start: interval.startSecond, end: interval.endSecond })),
        ),
      );
    }

    return { liveCoverageMs, recordedCoverageSeconds };
  }
}
