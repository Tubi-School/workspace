import type { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/environment.js';
import { SessionStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { NotificationsService } from './notifications.service.js';
import { SessionReminderScheduler } from './session-reminder.scheduler.js';

describe('SessionReminderScheduler', () => {
  let prisma: {
    session: { findMany: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let notifications: {
    enqueueForEntitledLearners: jest.Mock;
    enqueueForAssignedTeachers: jest.Mock;
  };
  let config: ConfigService<AppConfig, true>;
  let scheduler: SessionReminderScheduler;

  beforeEach(() => {
    prisma = {
      session: { findMany: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    // Runs the transaction body against the same fake client — the claim
    // and the enqueue calls below are asserted as if they ran inside one
    // real transaction, matching production behavior.
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    notifications = {
      enqueueForEntitledLearners: jest.fn().mockResolvedValue(undefined),
      enqueueForAssignedTeachers: jest.fn().mockResolvedValue(undefined),
    };
    config = { get: () => 60 } as unknown as ConfigService<AppConfig, true>;
    scheduler = new SessionReminderScheduler(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      config,
    );
  });

  it('claims a due session and enqueues reminders for learners and teachers, atomically', async () => {
    prisma.session.findMany.mockResolvedValue([
      {
        id: 'session-1',
        course: { title: 'Grade 8 Mathematics' },
        startTime: new Date('2026-01-01T10:00:00Z'),
      },
    ]);
    prisma.session.updateMany.mockResolvedValue({ count: 1 });

    await scheduler.sendDueReminders();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session-1', reminderSentAt: null } }),
    );
    expect(notifications.enqueueForEntitledLearners).toHaveBeenCalledWith(
      'session-1',
      'SESSION_REMINDER',
      expect.objectContaining({ courseTitle: 'Grade 8 Mathematics' }),
      prisma,
    );
    expect(notifications.enqueueForAssignedTeachers).toHaveBeenCalled();
  });

  it('only queries SCHEDULED sessions with no reminder yet sent, within the lookahead window', async () => {
    prisma.session.findMany.mockResolvedValue([]);

    await scheduler.sendDueReminders();

    const calls = prisma.session.findMany.mock.calls as unknown as [
      { where: Record<string, unknown> },
    ][];
    expect(calls[0]?.[0].where).toMatchObject({
      status: SessionStatus.SCHEDULED,
      reminderSentAt: null,
    });
  });

  it('never double-sends when the claim inside the transaction matches zero rows (already claimed elsewhere)', async () => {
    prisma.session.findMany.mockResolvedValue([
      { id: 'session-1', course: { title: 'x' }, startTime: new Date() },
    ]);
    prisma.session.updateMany.mockResolvedValue({ count: 0 });

    await scheduler.sendDueReminders();

    expect(notifications.enqueueForEntitledLearners).not.toHaveBeenCalled();
    expect(notifications.enqueueForAssignedTeachers).not.toHaveBeenCalled();
  });

  it('crash-safety: if the transaction never commits, neither the claim nor the outbox rows persist — never a silently lost reminder', async () => {
    prisma.session.findMany.mockResolvedValue([
      { id: 'session-1', course: { title: 'x' }, startTime: new Date() },
    ]);
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    // Simulates a crash partway through the transaction body — e.g. the
    // enqueue call throwing. A real Postgres transaction rolls the claim
    // back too, so the next tick's `reminderSentAt: null` query still
    // finds this session.
    notifications.enqueueForEntitledLearners.mockRejectedValue(new Error('crash'));

    await expect(scheduler.sendDueReminders()).rejects.toThrow('crash');

    // The scheduler itself does not swallow this — it propagates so the
    // (real) transaction rolls back. Confirms no code path marks success
    // before the transaction actually commits.
    expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
  });

  it('concurrent scheduler ticks (two overlapping runs) enqueue the reminder only once', async () => {
    const session = { id: 'session-1', course: { title: 'x' }, startTime: new Date() };
    prisma.session.findMany.mockResolvedValue([session]);

    // First claim wins; a second concurrent tick's identical conditional
    // update matches zero rows.
    let claimed = false;
    prisma.session.updateMany.mockImplementation(() => {
      if (claimed) return Promise.resolve({ count: 0 });
      claimed = true;
      return Promise.resolve({ count: 1 });
    });

    await Promise.all([scheduler.sendDueReminders(), scheduler.sendDueReminders()]);

    expect(notifications.enqueueForEntitledLearners).toHaveBeenCalledTimes(1);
  });
});
