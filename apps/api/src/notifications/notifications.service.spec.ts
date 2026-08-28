import { NotificationStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  let prisma: {
    notificationOutboxItem: { create: jest.Mock };
    sessionEntitlementSnapshot: { findMany: jest.Mock };
    sessionTeacher: { findMany: jest.Mock };
  };
  let service: NotificationsService;

  beforeEach(() => {
    prisma = {
      notificationOutboxItem: { create: jest.fn().mockResolvedValue({}) },
      sessionEntitlementSnapshot: { findMany: jest.fn() },
      sessionTeacher: { findMany: jest.fn() },
    };
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  it('enqueue writes one PENDING outbox row', async () => {
    await service.enqueue('ACCOUNT_REGISTERED', 'user-1', { fullName: 'A' });

    expect(prisma.notificationOutboxItem.create).toHaveBeenCalledWith({
      data: {
        type: 'ACCOUNT_REGISTERED',
        recipientUserId: 'user-1',
        payload: { fullName: 'A' },
        status: NotificationStatus.PENDING,
      },
    });
  });

  it('enqueueForEntitledLearners enqueues one notification per historically-entitled learner', async () => {
    prisma.sessionEntitlementSnapshot.findMany.mockResolvedValue([
      { learner: { user: { id: 'user-1' } } },
      { learner: { user: { id: 'user-2' } } },
    ]);

    await service.enqueueForEntitledLearners('session-1', 'SESSION_CANCELED', { courseTitle: 'x' });

    expect(prisma.notificationOutboxItem.create).toHaveBeenCalledTimes(2);
    expect(prisma.sessionEntitlementSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: 'session-1', wasEntitled: true } }),
    );
  });

  it('enqueueForAssignedTeachers enqueues one notification per staffed teacher', async () => {
    prisma.sessionTeacher.findMany.mockResolvedValue([
      { teacher: { user: { id: 'teacher-user-1' } } },
    ]);

    await service.enqueueForAssignedTeachers('session-1', 'SESSION_CANCELED', { courseTitle: 'x' });

    expect(prisma.notificationOutboxItem.create).toHaveBeenCalledTimes(1);
  });
});
