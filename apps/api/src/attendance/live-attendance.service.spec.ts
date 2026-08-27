import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceService } from './attendance.service.js';
import { LiveAttendanceIntervalService } from './live-attendance.service.js';

const SESSION_ID = 'session-1';
const LEARNER_ID = 'learner-1';

describe('LiveAttendanceIntervalService', () => {
  let prisma: {
    session: { findUnique: jest.Mock };
    liveAttendanceInterval: { create: jest.Mock; findMany: jest.Mock };
    sessionEntitlementSnapshot: { findUnique: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let attendanceService: AttendanceService;
  let service: LiveAttendanceIntervalService;

  const session = {
    id: SESSION_ID,
    startTime: new Date('2026-07-01T11:00:00Z'),
    endTime: new Date('2026-07-01T12:00:00Z'),
  };

  beforeEach(() => {
    prisma = {
      session: { findUnique: jest.fn().mockResolvedValue(session) },
      liveAttendanceInterval: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      sessionEntitlementSnapshot: {
        findUnique: jest.fn().mockResolvedValue({ wasEntitled: true }),
      },
      $queryRaw: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn(),
    };
    // Runs the transaction callback against the same fake client, tagged
    // with $queryRaw so withLearnerSessionLock's advisory-lock statement
    // resolves — mirrors the real Prisma.TransactionClient shape closely
    // enough for this service's own code to exercise its actual logic.
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    attendanceService = new AttendanceService(prisma as unknown as PrismaService);
    jest.spyOn(attendanceService, 'qualifyLive').mockResolvedValue(undefined);
    service = new LiveAttendanceIntervalService(
      prisma as unknown as PrismaService,
      attendanceService,
    );
  });

  it('rejects ingestion for a session that does not exist', async () => {
    prisma.session.findUnique.mockResolvedValue(null);

    await expect(
      service.ingest(SESSION_ID, {
        learnerId: LEARNER_ID,
        joinedAt: '2026-07-01T11:00:00Z',
        leftAt: '2026-07-01T11:30:00Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a malformed interval (joinedAt not before leftAt)', async () => {
    await expect(
      service.ingest(SESSION_ID, {
        learnerId: LEARNER_ID,
        joinedAt: '2026-07-01T11:30:00Z',
        leftAt: '2026-07-01T11:00:00Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.liveAttendanceInterval.create).not.toHaveBeenCalled();
  });

  it('rejects ingestion for a learner who was never entitled to the session', async () => {
    prisma.sessionEntitlementSnapshot.findUnique.mockResolvedValue(null);

    await expect(
      service.ingest(SESSION_ID, {
        learnerId: LEARNER_ID,
        joinedAt: '2026-07-01T11:00:00Z',
        leftAt: '2026-07-01T11:30:00Z',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveAttendanceInterval.create).not.toHaveBeenCalled();
  });

  it('clips coverage to the scheduled session window before qualifying', async () => {
    // Joined 30 minutes before the session and left 30 minutes after it —
    // only the 60-minute overlap with [startTime, endTime] should count.
    prisma.liveAttendanceInterval.findMany.mockResolvedValue([
      { joinedAt: new Date('2026-07-01T10:30:00Z'), leftAt: new Date('2026-07-01T12:30:00Z') },
    ]);

    await service.ingest(SESSION_ID, {
      learnerId: LEARNER_ID,
      joinedAt: '2026-07-01T10:30:00Z',
      leftAt: '2026-07-01T12:30:00Z',
    });

    expect(attendanceService.qualifyLive).toHaveBeenCalledWith(
      SESSION_ID,
      LEARNER_ID,
      60 * 60 * 1000, // clipped to exactly the 60-minute scheduled window
      60 * 60 * 1000,
      new Date('2026-07-01T12:30:00Z'),
      expect.anything(),
    );
  });

  it('accumulates disconnected intervals rather than only counting the latest one', async () => {
    prisma.liveAttendanceInterval.findMany.mockResolvedValue([
      { joinedAt: new Date('2026-07-01T11:00:00Z'), leftAt: new Date('2026-07-01T11:20:00Z') },
      { joinedAt: new Date('2026-07-01T11:30:00Z'), leftAt: new Date('2026-07-01T11:45:00Z') },
    ]);

    await service.ingest(SESSION_ID, {
      learnerId: LEARNER_ID,
      joinedAt: '2026-07-01T11:30:00Z',
      leftAt: '2026-07-01T11:45:00Z',
    });

    const expectedCoverageMs = 20 * 60 * 1000 + 15 * 60 * 1000;
    expect(attendanceService.qualifyLive).toHaveBeenCalledWith(
      SESSION_ID,
      LEARNER_ID,
      expectedCoverageMs,
      60 * 60 * 1000,
      expect.any(Date),
      expect.anything(),
    );
  });

  it('serializes ingestion for the same (sessionId, learnerId) pair via an advisory lock, so a create that lands during a concurrent read is still counted', async () => {
    // Simulates the race the concurrency correction closes: findMany is
    // stubbed to return the row that was just created by *this* call (as
    // it would once the create has actually committed inside the same
    // locked transaction), proving the ingest path re-reads from the same
    // transactional context it wrote to, not a stale outside read.
    let created: { joinedAt: Date; leftAt: Date } | undefined;
    prisma.liveAttendanceInterval.create.mockImplementation(
      ({ data }: { data: { joinedAt: Date; leftAt: Date } }) => {
        created = { joinedAt: data.joinedAt, leftAt: data.leftAt };
        return Promise.resolve(created);
      },
    );
    prisma.liveAttendanceInterval.findMany.mockImplementation(() =>
      Promise.resolve(created ? [created] : []),
    );

    await service.ingest(SESSION_ID, {
      learnerId: LEARNER_ID,
      joinedAt: '2026-07-01T11:00:00Z',
      leftAt: '2026-07-01T11:30:00Z',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(attendanceService.qualifyLive).toHaveBeenCalledWith(
      SESSION_ID,
      LEARNER_ID,
      30 * 60 * 1000,
      60 * 60 * 1000,
      expect.any(Date),
      expect.anything(),
    );
  });
});
