import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { AttendanceStatus, CompletionMode } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceService } from './attendance.service.js';

const SESSION_ID = 'session-1';
const LEARNER_ID = 'learner-1';
const NORMAL_CUTOFF = new Date('2026-07-01T21:59:00.000Z');
const SCHEDULED_DURATION_MS = 60 * 60 * 1000; // 60-minute session

describe('AttendanceService', () => {
  let prisma: {
    session: { findUniqueOrThrow: jest.Mock };
    attendanceWindowException: { findFirst: jest.Mock };
    attendanceRecord: {
      updateMany: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    attendanceOverride: { create: jest.Mock };
    sessionEntitlementSnapshot: { findUnique: jest.Mock };
    teacherProfile: { findUnique: jest.Mock };
    sessionTeacher: { findUnique: jest.Mock };
    liveAttendanceInterval: { findMany: jest.Mock };
    watchedInterval: { findMany: jest.Mock };
    sessionRecording: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: AttendanceService;

  beforeEach(() => {
    prisma = {
      session: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ attendanceCutoffAt: NORMAL_CUTOFF }),
      },
      attendanceWindowException: { findFirst: jest.fn().mockResolvedValue(null) },
      attendanceRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      attendanceOverride: { create: jest.fn() },
      sessionEntitlementSnapshot: { findUnique: jest.fn() },
      teacherProfile: { findUnique: jest.fn() },
      sessionTeacher: { findUnique: jest.fn() },
      liveAttendanceInterval: { findMany: jest.fn() },
      watchedInterval: { findMany: jest.fn() },
      sessionRecording: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    service = new AttendanceService(prisma as unknown as PrismaService);
  });

  describe('assertEntitled', () => {
    it('passes for an entitled learner', async () => {
      prisma.sessionEntitlementSnapshot.findUnique.mockResolvedValue({ wasEntitled: true });

      await expect(service.assertEntitled(SESSION_ID, LEARNER_ID)).resolves.toBeUndefined();
    });

    it('throws ForbiddenException for a learner with no snapshot', async () => {
      prisma.sessionEntitlementSnapshot.findUnique.mockResolvedValue(null);

      await expect(service.assertEntitled(SESSION_ID, LEARNER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('getEffectiveCutoff precedence', () => {
    it('uses the normal Session.attendanceCutoffAt when no exception exists', async () => {
      const result = await service.getEffectiveCutoff(SESSION_ID, LEARNER_ID);
      expect(result).toEqual(NORMAL_CUTOFF);
    });

    it('applies a session-wide exception over the normal cutoff', async () => {
      const sessionWide = new Date('2026-07-02T10:00:00.000Z');
      prisma.attendanceWindowException.findFirst.mockImplementation(
        ({ where }: { where: { learnerId: unknown } }) =>
          Promise.resolve(where.learnerId === null ? { extendedCutoffAt: sessionWide } : null),
      );

      const result = await service.getEffectiveCutoff(SESSION_ID, LEARNER_ID);
      expect(result).toEqual(sessionWide);
    });

    it('applies a learner-specific exception over both the normal cutoff and any session-wide one', async () => {
      const sessionWide = new Date('2026-07-02T10:00:00.000Z');
      const learnerSpecific = new Date('2026-07-03T10:00:00.000Z');
      prisma.attendanceWindowException.findFirst.mockImplementation(
        ({ where }: { where: { learnerId: unknown } }) =>
          Promise.resolve(
            where.learnerId === LEARNER_ID
              ? { extendedCutoffAt: learnerSpecific }
              : where.learnerId === null
                ? { extendedCutoffAt: sessionWide }
                : null,
          ),
      );

      const result = await service.getEffectiveCutoff(SESSION_ID, LEARNER_ID);
      // Deterministic precedence: learner-specific wins outright, even
      // though the session-wide grant in this test is chronologically later.
      expect(result).toEqual(learnerSpecific);
    });
  });

  describe('qualifyLive (50% threshold)', () => {
    it('does not qualify at just under 50% coverage', async () => {
      const coverageMs = SCHEDULED_DURATION_MS * 0.5 - 1000; // 29m59s of a 60-minute session

      await service.qualifyLive(
        SESSION_ID,
        LEARNER_ID,
        coverageMs,
        SCHEDULED_DURATION_MS,
        new Date(),
      );

      expect(prisma.attendanceRecord.updateMany).not.toHaveBeenCalled();
    });

    it('qualifies at exactly 50% coverage', async () => {
      const coverageMs = SCHEDULED_DURATION_MS * 0.5; // exactly 30 minutes

      await service.qualifyLive(
        SESSION_ID,
        LEARNER_ID,
        coverageMs,
        SCHEDULED_DURATION_MS,
        new Date('2026-07-01T11:30:00Z'),
      );

      expect(prisma.attendanceRecord.updateMany).toHaveBeenCalledWith({
        where: { sessionId: SESSION_ID, learnerId: LEARNER_ID, status: AttendanceStatus.PENDING },
        data: {
          status: AttendanceStatus.PRESENT,
          completionMode: CompletionMode.LIVE,
          completedAt: new Date('2026-07-01T11:30:00Z'),
        },
      });
    });

    it('qualifies above 50% coverage (45 of 60 minutes)', async () => {
      const coverageMs = 45 * 60 * 1000;

      await service.qualifyLive(
        SESSION_ID,
        LEARNER_ID,
        coverageMs,
        SCHEDULED_DURATION_MS,
        new Date('2026-07-01T11:45:00Z'),
      );

      expect(prisma.attendanceRecord.updateMany).toHaveBeenCalledTimes(1);
    });

    it('does not qualify a completion achieved after the effective cutoff', async () => {
      const afterCutoff = new Date(NORMAL_CUTOFF.getTime() + 1000);

      await service.qualifyLive(
        SESSION_ID,
        LEARNER_ID,
        SCHEDULED_DURATION_MS,
        SCHEDULED_DURATION_MS,
        afterCutoff,
      );

      expect(prisma.attendanceRecord.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('qualifyRecorded (100% threshold)', () => {
    it('does not qualify at partial coverage', async () => {
      await service.qualifyRecorded(SESSION_ID, LEARNER_ID, 59, 60, new Date());

      expect(prisma.attendanceRecord.updateMany).not.toHaveBeenCalled();
    });

    it('qualifies at genuine 100% coverage', async () => {
      const at = new Date('2026-07-01T15:00:00Z');
      await service.qualifyRecorded(SESSION_ID, LEARNER_ID, 3600, 3600, at);

      expect(prisma.attendanceRecord.updateMany).toHaveBeenCalledWith({
        where: { sessionId: SESSION_ID, learnerId: LEARNER_ID, status: AttendanceStatus.PENDING },
        data: {
          status: AttendanceStatus.PRESENT,
          completionMode: CompletionMode.RECORDED,
          completedAt: at,
        },
      });
    });

    it('does not qualify completion (even genuine 100%) achieved after the effective cutoff', async () => {
      const afterCutoff = new Date(NORMAL_CUTOFF.getTime() + 1000);

      await service.qualifyRecorded(SESSION_ID, LEARNER_ID, 3600, 3600, afterCutoff);

      expect(prisma.attendanceRecord.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('finalizeDueRecords', () => {
    it('moves a PENDING record whose effective cutoff has passed to ABSENT with null completion fields', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { sessionId: SESSION_ID, learnerId: LEARNER_ID },
      ]);
      prisma.session.findUniqueOrThrow.mockResolvedValue({
        attendanceCutoffAt: new Date(Date.now() - 1000), // already in the past
      });

      const result = await service.finalizeDueRecords();

      expect(prisma.attendanceRecord.updateMany).toHaveBeenCalledWith({
        where: { sessionId: SESSION_ID, learnerId: LEARNER_ID, status: AttendanceStatus.PENDING },
        data: { status: AttendanceStatus.ABSENT, completionMode: null, completedAt: null },
      });
      expect(result.finalizedCount).toBe(1);
    });

    it('leaves a PENDING record alone before its effective cutoff', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { sessionId: SESSION_ID, learnerId: LEARNER_ID },
      ]);
      prisma.session.findUniqueOrThrow.mockResolvedValue({
        attendanceCutoffAt: new Date(Date.now() + 60 * 60 * 1000), // an hour from now
      });

      const result = await service.finalizeDueRecords();

      expect(prisma.attendanceRecord.updateMany).not.toHaveBeenCalled();
      expect(result.finalizedCount).toBe(0);
    });

    it('only ever touches rows still PENDING (the status guard), so it is safe to call repeatedly', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { sessionId: SESSION_ID, learnerId: LEARNER_ID },
      ]);
      prisma.session.findUniqueOrThrow.mockResolvedValue({
        attendanceCutoffAt: new Date(Date.now() - 1000),
      });

      await service.finalizeDueRecords();
      // Second run: updateMany's own WHERE status=PENDING means a record
      // already flipped to ABSENT by the first run is not matched again —
      // simulate that by having updateMany report 0 affected rows.
      prisma.attendanceRecord.updateMany.mockResolvedValueOnce({ count: 0 });
      const secondResult = await service.finalizeDueRecords();

      expect(secondResult.finalizedCount).toBe(0);
    });
  });

  describe('override', () => {
    it('requires a reason and records audit attribution, applying the new status', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'record-1',
        status: AttendanceStatus.ABSENT,
      });
      const updated = { id: 'record-1', status: AttendanceStatus.PRESENT };
      prisma.attendanceRecord.update.mockResolvedValue(updated);

      const result = await service.override(
        'record-1',
        {
          newStatus: AttendanceStatus.PRESENT,
          completionMode: CompletionMode.LIVE,
          completedAt: '2026-07-01T11:30:00.000Z',
          reason: 'Documented technical failure, confirmed by teacher',
        },
        'admin-user-1',
      );

      expect(prisma.attendanceOverride.create).toHaveBeenCalledWith({
        data: {
          attendanceRecordId: 'record-1',
          previousStatus: AttendanceStatus.ABSENT,
          newStatus: AttendanceStatus.PRESENT,
          performedByUserId: 'admin-user-1',
          reason: 'Documented technical failure, confirmed by teacher',
        },
      });
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException for a missing attendance record', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.override(
          'missing',
          { newStatus: AttendanceStatus.ABSENT, reason: 'x' },
          'admin-user-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('never touches LiveAttendanceInterval/WatchedInterval rows — only AttendanceRecord and AttendanceOverride', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'record-1',
        status: AttendanceStatus.PENDING,
      });
      prisma.attendanceRecord.update.mockResolvedValue({
        id: 'record-1',
        status: AttendanceStatus.ABSENT,
      });

      await service.override(
        'record-1',
        { newStatus: AttendanceStatus.ABSENT, reason: 'x' },
        'admin-user-1',
      );

      expect(prisma.liveAttendanceInterval.findMany).not.toHaveBeenCalled();
      expect(prisma.watchedInterval.findMany).not.toHaveBeenCalled();
    });
  });

  describe('assertTeacherAssignedToSession', () => {
    it('passes when the teacher is assigned to the session', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue({ id: 'teacher-profile-1' });
      prisma.sessionTeacher.findUnique.mockResolvedValue({ teacherRole: 'ASSISTANT' });

      await expect(
        service.assertTeacherAssignedToSession('teacher-user-1', SESSION_ID),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when the teacher is not assigned to the session', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue({ id: 'teacher-profile-1' });
      prisma.sessionTeacher.findUnique.mockResolvedValue(null);

      await expect(
        service.assertTeacherAssignedToSession('teacher-user-1', SESSION_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
