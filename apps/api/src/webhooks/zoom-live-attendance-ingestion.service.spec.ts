import { Prisma } from '../generated/prisma/client.js';
import type { LiveAttendanceIntervalService } from '../attendance/live-attendance.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ZoomLiveAttendanceIngestionService } from './zoom-live-attendance-ingestion.service.js';

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function recordNotFoundError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

describe('ZoomLiveAttendanceIngestionService', () => {
  let prisma: {
    session: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    liveParticipantSession: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
  };
  let liveAttendanceIntervalService: { ingest: jest.Mock };
  let service: ZoomLiveAttendanceIngestionService;

  beforeEach(() => {
    prisma = {
      session: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      liveParticipantSession: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    };
    liveAttendanceIntervalService = { ingest: jest.fn().mockResolvedValue(undefined) };
    service = new ZoomLiveAttendanceIngestionService(
      prisma as unknown as PrismaService,
      liveAttendanceIntervalService as unknown as LiveAttendanceIntervalService,
    );
  });

  describe('handleParticipantJoined', () => {
    it('opens a LiveParticipantSession row for a matched learner', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.user.findUnique.mockResolvedValue({ learnerProfile: { id: 'learner-1' } });

      await service.handleParticipantJoined('zoom-1', 'p1', 'Learner@Example.com', new Date());

      const calls = prisma.liveParticipantSession.create.mock.calls as unknown as [
        { data: { sessionId: string; learnerId: string; providerParticipantId: string } },
      ][];
      expect(calls[0]?.[0].data).toMatchObject({
        sessionId: 'session-1',
        learnerId: 'learner-1',
        providerParticipantId: 'p1',
      });
      // Email is normalised before lookup, exactly like AuthService.
      const userLookupCalls = prisma.user.findUnique.mock.calls as unknown as [
        { where: { email: string } },
      ][];
      expect(userLookupCalls[0]?.[0].where.email).toBe('learner@example.com');
    });

    it('ignores an unknown meeting id', async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await service.handleParticipantJoined('unknown', 'p1', 'a@b.com', new Date());

      expect(prisma.liveParticipantSession.create).not.toHaveBeenCalled();
    });

    it('ignores a participant with no matching learner account', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.user.findUnique.mockResolvedValue(null);

      await service.handleParticipantJoined('zoom-1', 'p1', 'nobody@example.com', new Date());

      expect(prisma.liveParticipantSession.create).not.toHaveBeenCalled();
    });

    it('swallows a genuine duplicate/replayed join (P2002 unique constraint) for the same participant connection', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.user.findUnique.mockResolvedValue({ learnerProfile: { id: 'learner-1' } });
      prisma.liveParticipantSession.create.mockRejectedValue(uniqueConstraintError());

      await expect(
        service.handleParticipantJoined('zoom-1', 'p1', 'a@b.com', new Date()),
      ).resolves.toBeUndefined();
    });

    it('propagates a genuine database failure instead of swallowing it (Correction 7)', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.user.findUnique.mockResolvedValue({ learnerProfile: { id: 'learner-1' } });
      prisma.liveParticipantSession.create.mockRejectedValue(new Error('connection reset'));

      await expect(
        service.handleParticipantJoined('zoom-1', 'p1', 'a@b.com', new Date()),
      ).rejects.toThrow('connection reset');
    });
  });

  describe('handleParticipantLeft', () => {
    it('ingests before consuming the open row, and consumes it after ingestion succeeds', async () => {
      const joinedAt = new Date('2026-01-01T10:00:00Z');
      const leftAt = new Date('2026-01-01T10:30:00Z');
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.liveParticipantSession.findUnique.mockResolvedValue({
        id: 'lps-1',
        learnerId: 'learner-1',
        joinedAt,
      });

      await service.handleParticipantLeft('zoom-1', 'p1', leftAt);

      expect(liveAttendanceIntervalService.ingest).toHaveBeenCalledWith('session-1', {
        learnerId: 'learner-1',
        joinedAt: joinedAt.toISOString(),
        leftAt: leftAt.toISOString(),
      });
      expect(prisma.liveParticipantSession.delete).toHaveBeenCalledWith({ where: { id: 'lps-1' } });

      const ingestOrder = liveAttendanceIntervalService.ingest.mock.invocationCallOrder[0]!;
      const deleteOrder = prisma.liveParticipantSession.delete.mock.invocationCallOrder[0]!;
      expect(ingestOrder).toBeLessThan(deleteOrder);
    });

    it('Correction 1 (adversarial): if ingestion fails, the open join is never consumed, so a retry can still complete it', async () => {
      const joinedAt = new Date('2026-01-01T10:00:00Z');
      const leftAt = new Date('2026-01-01T10:30:00Z');
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.liveParticipantSession.findUnique.mockResolvedValue({
        id: 'lps-1',
        learnerId: 'learner-1',
        joinedAt,
      });
      liveAttendanceIntervalService.ingest.mockRejectedValueOnce(new Error('transient failure'));

      await expect(service.handleParticipantLeft('zoom-1', 'p1', leftAt)).rejects.toThrow(
        'transient failure',
      );
      expect(prisma.liveParticipantSession.delete).not.toHaveBeenCalled();

      // Retry: the open row is still there (findUnique still resolves it),
      // ingestion succeeds this time, and it is now consumed.
      liveAttendanceIntervalService.ingest.mockResolvedValueOnce(undefined);
      await service.handleParticipantLeft('zoom-1', 'p1', leftAt);

      expect(liveAttendanceIntervalService.ingest).toHaveBeenCalledTimes(2);
      expect(prisma.liveParticipantSession.delete).toHaveBeenCalledTimes(1);
    });

    it('tolerates the open row already having been consumed by a concurrent/retried delivery (P2025 on delete)', async () => {
      const joinedAt = new Date('2026-01-01T10:00:00Z');
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.liveParticipantSession.findUnique.mockResolvedValue({
        id: 'lps-1',
        learnerId: 'learner-1',
        joinedAt,
      });
      prisma.liveParticipantSession.delete.mockRejectedValue(recordNotFoundError());

      await expect(
        service.handleParticipantLeft('zoom-1', 'p1', new Date()),
      ).resolves.toBeUndefined();
      expect(liveAttendanceIntervalService.ingest).toHaveBeenCalledTimes(1);
    });

    it('propagates a genuine database failure on delete rather than swallowing it', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.liveParticipantSession.findUnique.mockResolvedValue({
        id: 'lps-1',
        learnerId: 'learner-1',
        joinedAt: new Date(),
      });
      prisma.liveParticipantSession.delete.mockRejectedValue(new Error('connection reset'));

      await expect(service.handleParticipantLeft('zoom-1', 'p1', new Date())).rejects.toThrow(
        'connection reset',
      );
    });

    it('ignores a duplicate/replayed leave with no open row (never double-ingests)', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.liveParticipantSession.findUnique.mockResolvedValue(null);

      await service.handleParticipantLeft('zoom-1', 'p1', new Date());

      expect(liveAttendanceIntervalService.ingest).not.toHaveBeenCalled();
    });

    it('ignores an unknown meeting id', async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await service.handleParticipantLeft('unknown', 'p1', new Date());

      expect(liveAttendanceIntervalService.ingest).not.toHaveBeenCalled();
    });
  });
});
