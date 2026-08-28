import { ConflictException, NotFoundException } from '@nestjs/common';

import { Prisma, SessionStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { RecordingService } from './recording.service.js';

const SESSION_ID = 'session-1';

describe('RecordingService', () => {
  let prisma: {
    session: { findUnique: jest.Mock };
    sessionRecording: { create: jest.Mock; findUnique: jest.Mock };
  };
  let service: RecordingService;

  beforeEach(() => {
    prisma = {
      session: { findUnique: jest.fn() },
      sessionRecording: { create: jest.fn(), findUnique: jest.fn() },
    };
    service = new RecordingService(prisma as unknown as PrismaService);
  });

  it('publishes a recording for an ENDED session', async () => {
    prisma.session.findUnique.mockResolvedValue({ id: SESSION_ID, status: SessionStatus.ENDED });
    prisma.sessionRecording.create.mockResolvedValue({ id: 'recording-1', sessionId: SESSION_ID });

    const result = await service.publish(SESSION_ID, {
      recordingUrl: 'https://example.com/recording.mp4',
      totalSeconds: 3600,
    });

    expect(result.id).toBe('recording-1');
  });

  it('rejects publishing for a session that does not exist', async () => {
    prisma.session.findUnique.mockResolvedValue(null);

    await expect(
      service.publish(SESSION_ID, {
        recordingUrl: 'https://example.com/r.mp4',
        totalSeconds: 3600,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects publishing for a session that has not ended (e.g. still SCHEDULED)', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: SESSION_ID,
      status: SessionStatus.SCHEDULED,
    });

    await expect(
      service.publish(SESSION_ID, {
        recordingUrl: 'https://example.com/r.mp4',
        totalSeconds: 3600,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a second publish attempt for a session that already has a recording', async () => {
    prisma.session.findUnique.mockResolvedValue({ id: SESSION_ID, status: SessionStatus.ENDED });
    prisma.sessionRecording.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`sessionId`)',
        {
          code: 'P2002',
          clientVersion: 'test',
        },
      ),
    );

    await expect(
      service.publish(SESSION_ID, {
        recordingUrl: 'https://example.com/r.mp4',
        totalSeconds: 3600,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('publishing a recording does not itself touch AttendanceRecord (no attendance side effect)', async () => {
    prisma.session.findUnique.mockResolvedValue({ id: SESSION_ID, status: SessionStatus.ENDED });
    prisma.sessionRecording.create.mockResolvedValue({ id: 'recording-1' });

    await service.publish(SESSION_ID, {
      recordingUrl: 'https://example.com/r.mp4',
      totalSeconds: 3600,
    });

    // RecordingService has no attendanceRecord dependency at all — this
    // test documents that fact rather than exercising a mock.
    expect(Object.keys(prisma)).not.toContain('attendanceRecord');
  });

  describe('publishFromProvider (Phase 4 external review Correction 9)', () => {
    const providerData = {
      recordingUrl: 'https://zoom.us/rec/share/rec-1',
      totalSeconds: 1800,
      availableFrom: new Date(),
      provider: 'ZOOM',
      providerRecordingId: 'rec-1',
    };

    it('reports created: true for a genuinely new publication', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: SESSION_ID, status: SessionStatus.ENDED });
      prisma.sessionRecording.create.mockResolvedValue({
        id: 'recording-1',
        sessionId: SESSION_ID,
      });

      const result = await service.publishFromProvider(SESSION_ID, providerData);

      expect(result).toEqual({
        recording: { id: 'recording-1', sessionId: SESSION_ID },
        created: true,
      });
    });

    it('reports created: false (idempotent no-op) when this session already has a recording', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: SESSION_ID, status: SessionStatus.ENDED });
      prisma.sessionRecording.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      const existing = { id: 'recording-1', sessionId: SESSION_ID, providerRecordingId: 'rec-1' };
      prisma.sessionRecording.findUnique.mockResolvedValue(existing);

      const result = await service.publishFromProvider(SESSION_ID, providerData);

      expect(result).toEqual({ recording: existing, created: false });
    });

    it('never treats a providerRecordingId conflict belonging to a DIFFERENT session as successful publication of this session', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: SESSION_ID, status: SessionStatus.ENDED });
      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`providerRecordingId`)',
        { code: 'P2002', clientVersion: 'test' },
      );
      prisma.sessionRecording.create.mockRejectedValue(conflict);
      // This session itself has no recording — the conflict was really
      // about providerRecordingId belonging to some other session.
      prisma.sessionRecording.findUnique.mockResolvedValue(null);

      await expect(service.publishFromProvider(SESSION_ID, providerData)).rejects.toThrow(conflict);
    });

    it('returns null for a session that has not ended, never publishing', async () => {
      prisma.session.findUnique.mockResolvedValue({ id: SESSION_ID, status: SessionStatus.LIVE });

      await expect(service.publishFromProvider(SESSION_ID, providerData)).resolves.toBeNull();
      expect(prisma.sessionRecording.create).not.toHaveBeenCalled();
    });
  });
});
