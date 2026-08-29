import { NotificationStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  let prisma: {
    notificationOutboxItem: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
    };
    sessionEntitlementSnapshot: { findMany: jest.Mock };
    sessionTeacher: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let service: NotificationsService;

  beforeEach(() => {
    prisma = {
      notificationOutboxItem: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
      sessionEntitlementSnapshot: { findMany: jest.fn() },
      sessionTeacher: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
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

  describe('listAll', () => {
    it('joins the recipient user for each outbox row', async () => {
      prisma.notificationOutboxItem.findMany.mockResolvedValue([
        { id: 'n1', recipientUserId: 'user-1', status: NotificationStatus.FAILED },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@x.com', fullName: 'A' }]);

      const result = await service.listAll();

      expect(result).toEqual([
        {
          id: 'n1',
          recipientUserId: 'user-1',
          status: NotificationStatus.FAILED,
          recipient: { id: 'user-1', email: 'a@x.com', fullName: 'A' },
        },
      ]);
    });

    it('filters by status when provided', async () => {
      prisma.notificationOutboxItem.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      await service.listAll(NotificationStatus.FAILED);

      expect(prisma.notificationOutboxItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: NotificationStatus.FAILED } }),
      );
    });

    it('never requests or returns claimToken, claimedAt, or payload — internal fencing state stays server-side', async () => {
      prisma.notificationOutboxItem.findMany.mockResolvedValue([
        { id: 'n1', recipientUserId: 'user-1', status: NotificationStatus.FAILED },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@x.com', fullName: 'A' }]);

      const result = await service.listAll();

      const [callArgs] = prisma.notificationOutboxItem.findMany.mock.calls[0] as [
        { select?: Record<string, boolean> },
      ];
      expect(callArgs.select).toBeDefined();
      expect(callArgs.select).not.toHaveProperty('claimToken');
      expect(callArgs.select).not.toHaveProperty('claimedAt');
      expect(callArgs.select).not.toHaveProperty('payload');

      expect(result[0]).not.toHaveProperty('claimToken');
      expect(result[0]).not.toHaveProperty('claimedAt');
      expect(result[0]).not.toHaveProperty('payload');
    });
  });

  describe('retryFailed', () => {
    it('resets a FAILED item to PENDING, clears fencing/error fields, and returns the minimized shape', async () => {
      prisma.notificationOutboxItem.findUnique.mockResolvedValue({
        id: 'n1',
        status: NotificationStatus.FAILED,
      });
      prisma.notificationOutboxItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.notificationOutboxItem.findMany.mockResolvedValue([
        { id: 'n1', recipientUserId: 'user-1', status: NotificationStatus.PENDING },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'a@x.com', fullName: 'A' }]);

      const result = await service.retryFailed('n1');

      expect(prisma.notificationOutboxItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', status: NotificationStatus.FAILED },
        data: {
          status: NotificationStatus.PENDING,
          claimToken: null,
          claimedAt: null,
          attempts: 0,
          lastError: null,
        },
      });
      expect(result).toEqual({
        id: 'n1',
        recipientUserId: 'user-1',
        status: NotificationStatus.PENDING,
        recipient: { id: 'user-1', email: 'a@x.com', fullName: 'A' },
      });
      expect(result).not.toHaveProperty('claimToken');
      expect(result).not.toHaveProperty('claimedAt');
    });

    it('rejects a notification that does not exist', async () => {
      prisma.notificationOutboxItem.findUnique.mockResolvedValue(null);

      await expect(service.retryFailed('missing')).rejects.toThrow('not found');
    });

    it('rejects a notification that is not FAILED', async () => {
      prisma.notificationOutboxItem.findUnique.mockResolvedValue({
        id: 'n1',
        status: NotificationStatus.SENT,
      });

      await expect(service.retryFailed('n1')).rejects.toThrow('not FAILED');
    });

    it('rejects when a concurrent claim wins the race (CAS miss)', async () => {
      prisma.notificationOutboxItem.findUnique.mockResolvedValue({
        id: 'n1',
        status: NotificationStatus.FAILED,
      });
      prisma.notificationOutboxItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.retryFailed('n1')).rejects.toThrow('no longer FAILED');
    });
  });
});
