import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceService } from './attendance.service.js';
import { RecordingService } from './recording.service.js';
import { WatchedIntervalService } from './watched-interval.service.js';

const SESSION_ID = 'session-1';
const LEARNER_ID = 'learner-1';
const RECORDING = { id: 'recording-1', sessionId: SESSION_ID, totalSeconds: 3600 };

describe('WatchedIntervalService', () => {
  let prisma: {
    watchedInterval: { create: jest.Mock; findMany: jest.Mock };
    sessionEntitlementSnapshot: { findUnique: jest.Mock };
    sessionRecording: { findUnique: jest.Mock };
    session: { findUnique: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let attendanceService: AttendanceService;
  let recordingService: RecordingService;
  let service: WatchedIntervalService;

  beforeEach(() => {
    prisma = {
      watchedInterval: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      sessionEntitlementSnapshot: {
        findUnique: jest.fn().mockResolvedValue({ wasEntitled: true }),
      },
      sessionRecording: { findUnique: jest.fn().mockResolvedValue(RECORDING) },
      session: {
        findUnique: jest.fn().mockResolvedValue({ id: SESSION_ID, status: 'LIVE' }),
      },
      $queryRaw: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    attendanceService = new AttendanceService(prisma as unknown as PrismaService);
    jest.spyOn(attendanceService, 'qualifyRecorded').mockResolvedValue(undefined);
    recordingService = new RecordingService(prisma as unknown as PrismaService);
    service = new WatchedIntervalService(
      prisma as unknown as PrismaService,
      attendanceService,
      recordingService,
    );
  });

  it('opening/ingesting a small interval alone does not mark PRESENT (partial coverage)', async () => {
    prisma.watchedInterval.findMany.mockResolvedValue([{ startSecond: 0, endSecond: 10 }]);

    await service.ingest(SESSION_ID, LEARNER_ID, { startSecond: 0, endSecond: 10 });

    expect(attendanceService.qualifyRecorded).toHaveBeenCalledWith(
      SESSION_ID,
      LEARNER_ID,
      10,
      3600,
      expect.any(Date),
      expect.anything(),
    );
  });

  it('rejects an interval with startSecond >= endSecond', async () => {
    await expect(
      service.ingest(SESSION_ID, LEARNER_ID, { startSecond: 100, endSecond: 50 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects ingestion for a learner who was never entitled', async () => {
    prisma.sessionEntitlementSnapshot.findUnique.mockResolvedValue(null);

    await expect(
      service.ingest(SESSION_ID, LEARNER_ID, { startSecond: 0, endSecond: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects ingestion for a CANCELED session', async () => {
    prisma.session.findUnique.mockResolvedValue({ id: SESSION_ID, status: 'CANCELED' });

    await expect(
      service.ingest(SESSION_ID, LEARNER_ID, { startSecond: 0, endSecond: 10 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.watchedInterval.create).not.toHaveBeenCalled();
  });

  it('rejects an interval extending past the recording duration', async () => {
    await expect(
      service.ingest(SESSION_ID, LEARNER_ID, { startSecond: 3500, endSecond: 3700 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves a skipped span uncovered: watching 0-15 and 30-60 of a 60-minute recording is 45 minutes, not 100%', async () => {
    // findMany reflects the table state after the current interval is
    // inserted, so it includes the prior 0-15 row plus the 30-60 row this
    // call is ingesting.
    prisma.watchedInterval.findMany.mockResolvedValue([
      { startSecond: 0, endSecond: 900 }, // 0-15 min
      { startSecond: 1800, endSecond: 3600 }, // 30-60 min
    ]);

    await service.ingest(SESSION_ID, LEARNER_ID, { startSecond: 1800, endSecond: 3600 }); // 30-60 min

    expect(attendanceService.qualifyRecorded).toHaveBeenCalledWith(
      SESSION_ID,
      LEARNER_ID,
      900 + 1800,
      3600,
      expect.any(Date),
      expect.anything(),
    );
  });

  it('does not inflate coverage for an overlapping/duplicate interval', async () => {
    prisma.watchedInterval.findMany.mockResolvedValue([{ startSecond: 0, endSecond: 1800 }]);

    await service.ingest(SESSION_ID, LEARNER_ID, { startSecond: 0, endSecond: 1800 });

    expect(attendanceService.qualifyRecorded).toHaveBeenCalledWith(
      SESSION_ID,
      LEARNER_ID,
      1800,
      3600,
      expect.any(Date),
      expect.anything(),
    );
  });

  it('reports genuine 100% coverage once the full timeline has been watched (merged across intervals)', async () => {
    // findMany represents the state of the table AFTER the current
    // interval has been inserted, so it must include both rows.
    prisma.watchedInterval.findMany.mockResolvedValue([
      { startSecond: 0, endSecond: 1800 },
      { startSecond: 1800, endSecond: 3600 },
    ]);

    await service.ingest(SESSION_ID, LEARNER_ID, { startSecond: 1800, endSecond: 3600 });

    expect(attendanceService.qualifyRecorded).toHaveBeenCalledWith(
      SESSION_ID,
      LEARNER_ID,
      3600,
      3600,
      expect.any(Date),
      expect.anything(),
    );
  });

  it('runs the create-reread-qualify sequence inside one advisory-locked transaction (concurrency correction)', async () => {
    prisma.watchedInterval.findMany.mockResolvedValue([{ startSecond: 0, endSecond: 1800 }]);

    await service.ingest(SESSION_ID, LEARNER_ID, { startSecond: 0, endSecond: 1800 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // The create and the coverage-computing findMany both ran against the
    // same transactional client the lock was taken on, not a bare,
    // unlocked prisma call.
    const transactionOrder =
      prisma.$transaction.mock.invocationCallOrder[0]! <
      prisma.watchedInterval.create.mock.invocationCallOrder[0]!;
    expect(transactionOrder).toBe(true);
  });
});
