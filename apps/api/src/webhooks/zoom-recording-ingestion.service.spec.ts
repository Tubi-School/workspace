import { ConflictException } from '@nestjs/common';

import type { RecordingService } from '../attendance/recording.service.js';
import { SessionStatus } from '../generated/prisma/client.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import { ZoomRecordingIngestionService } from './zoom-recording-ingestion.service.js';

describe('ZoomRecordingIngestionService', () => {
  let prisma: { session: { findUnique: jest.Mock }; course: { findUnique: jest.Mock } };
  let sessionsService: { markEnded: jest.Mock };
  let recordingService: { publishFromProvider: jest.Mock };
  let notifications: { enqueueForEntitledLearners: jest.Mock };
  let service: ZoomRecordingIngestionService;

  const payload = {
    providerMeetingId: 'zoom-1',
    providerRecordingId: 'rec-1',
    shareUrl: 'https://zoom.us/rec/share/rec-1',
    totalSeconds: 1800,
  };

  beforeEach(() => {
    prisma = { session: { findUnique: jest.fn() }, course: { findUnique: jest.fn() } };
    sessionsService = { markEnded: jest.fn() };
    recordingService = { publishFromProvider: jest.fn() };
    notifications = { enqueueForEntitledLearners: jest.fn().mockResolvedValue(undefined) };
    service = new ZoomRecordingIngestionService(
      prisma as unknown as PrismaService,
      sessionsService as unknown as SessionsService,
      recordingService as unknown as RecordingService,
      notifications as unknown as NotificationsService,
    );
  });

  it('publishes the recording directly for an already-ENDED session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      status: SessionStatus.ENDED,
      courseId: 'course-1',
    });
    recordingService.publishFromProvider.mockResolvedValue({
      recording: { id: 'recording-1' },
      created: true,
    });
    prisma.course.findUnique.mockResolvedValue({ title: 'Grade 8 Mathematics' });

    await service.ingest(payload);

    expect(sessionsService.markEnded).not.toHaveBeenCalled();
    expect(recordingService.publishFromProvider).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        recordingUrl: payload.shareUrl,
        totalSeconds: 1800,
        provider: 'ZOOM',
        providerRecordingId: 'rec-1',
      }),
    );
    expect(notifications.enqueueForEntitledLearners).toHaveBeenCalledWith(
      'session-1',
      'RECORDING_AVAILABLE',
      expect.objectContaining({ courseTitle: 'Grade 8 Mathematics' }),
    );
  });

  it('transitions a LIVE session to ENDED before publishing (the real-world "class has ended" signal)', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      status: SessionStatus.LIVE,
      courseId: 'course-1',
    });
    recordingService.publishFromProvider.mockResolvedValue({
      recording: { id: 'recording-1' },
      created: true,
    });
    prisma.course.findUnique.mockResolvedValue({ title: 'x' });

    await service.ingest(payload);

    expect(sessionsService.markEnded).toHaveBeenCalledWith('session-1');
    expect(recordingService.publishFromProvider).toHaveBeenCalled();
  });

  it('tolerates losing the LIVE->ENDED race to another caller', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      status: SessionStatus.LIVE,
      courseId: 'course-1',
    });
    sessionsService.markEnded.mockRejectedValue(new ConflictException('already ended'));
    recordingService.publishFromProvider.mockResolvedValue({
      recording: { id: 'recording-1' },
      created: true,
    });
    prisma.course.findUnique.mockResolvedValue({ title: 'x' });

    await expect(service.ingest(payload)).resolves.toBeUndefined();
    expect(recordingService.publishFromProvider).toHaveBeenCalled();
  });

  it('never resurrects a CANCELED session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      status: SessionStatus.CANCELED,
      courseId: 'course-1',
    });

    await service.ingest(payload);

    expect(sessionsService.markEnded).not.toHaveBeenCalled();
    expect(recordingService.publishFromProvider).not.toHaveBeenCalled();
  });

  it('ignores a recording for a session that never went live', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      status: SessionStatus.SCHEDULED,
      courseId: 'course-1',
    });

    await service.ingest(payload);

    expect(recordingService.publishFromProvider).not.toHaveBeenCalled();
  });

  it('ignores a recording for an unknown meeting id', async () => {
    prisma.session.findUnique.mockResolvedValue(null);

    await service.ingest(payload);

    expect(recordingService.publishFromProvider).not.toHaveBeenCalled();
  });

  it('does not notify when publishFromProvider itself is not applicable (returns null — session not found/not eligible)', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      status: SessionStatus.ENDED,
      courseId: 'course-1',
    });
    recordingService.publishFromProvider.mockResolvedValue(null);

    await service.ingest(payload);

    expect(notifications.enqueueForEntitledLearners).not.toHaveBeenCalled();
  });

  it('does not notify a second time when publishFromProvider reports a redelivered event (created: false) — Correction 9', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      status: SessionStatus.ENDED,
      courseId: 'course-1',
    });
    recordingService.publishFromProvider.mockResolvedValue({
      recording: { id: 'recording-1' },
      created: false,
    });

    await service.ingest(payload);

    expect(notifications.enqueueForEntitledLearners).not.toHaveBeenCalled();
  });

  it('propagates a genuine publishFromProvider failure (e.g. providerRecordingId conflict on a different session) so the webhook is marked failed', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      status: SessionStatus.ENDED,
      courseId: 'course-1',
    });
    recordingService.publishFromProvider.mockRejectedValue(
      new Error('providerRecordingId conflict'),
    );

    await expect(service.ingest(payload)).rejects.toThrow('providerRecordingId conflict');
    expect(notifications.enqueueForEntitledLearners).not.toHaveBeenCalled();
  });
});
