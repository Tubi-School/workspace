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
});
