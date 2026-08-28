import { NotificationStatus, type NotificationOutboxItem } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { EmailProviderService } from './email-provider.service.js';
import { NotificationDispatchScheduler } from './notification-dispatch.scheduler.js';

function buildItem(overrides: Partial<NotificationOutboxItem> = {}): NotificationOutboxItem {
  return {
    id: 'item-1',
    type: 'ACCOUNT_REGISTERED',
    recipientUserId: 'user-1',
    payload: { fullName: 'A' },
    status: NotificationStatus.PENDING,
    attempts: 0,
    createdAt: new Date(),
    claimedAt: null,
    claimToken: null,
    sentAt: null,
    lastError: null,
    ...overrides,
  };
}

/** A tiny in-memory outbox store so both the claim and the fenced finalize
 * `updateMany` calls are evaluated the way Postgres would — needed for
 * the genuine multi-instance concurrency and fencing tests below, not
 * just canned return values. */
function buildFakePrisma(initialItems: NotificationOutboxItem[]) {
  const items = new Map(initialItems.map((item) => [item.id, { ...item }]));

  const prisma = {
    notificationOutboxItem: {
      findMany: jest.fn(() => Promise.resolve([...items.values()])),
      updateMany: jest.fn(
        (args: {
          where: {
            id?: string;
            OR?: Array<{ status: NotificationStatus; claimedAt?: { lt: Date } }>;
            claimToken?: string;
            status?: NotificationStatus;
          };
          data: Partial<NotificationOutboxItem>;
        }) => {
          const { where, data } = args;
          const targets = where.id
            ? [items.get(where.id)].filter((i): i is NotificationOutboxItem => !!i)
            : [...items.values()];
          let count = 0;
          for (const item of targets) {
            let matches: boolean;
            if (where.OR) {
              matches = where.OR.some((clause) => {
                if (clause.status !== item.status) return false;
                if (clause.claimedAt) {
                  return (
                    item.claimedAt !== null &&
                    item.claimedAt.getTime() < clause.claimedAt.lt.getTime()
                  );
                }
                return true;
              });
            } else if (where.claimToken !== undefined) {
              matches = item.claimToken === where.claimToken && item.status === where.status;
            } else {
              matches = true;
            }

            if (matches) {
              Object.assign(item, data);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      ),
    },
    user: {
      findUnique: jest.fn(() => Promise.resolve({ email: 'user@example.com' })),
    },
  };

  return { prisma, items };
}

interface UpdateManyCallArgs {
  where: { id?: string; claimToken?: string };
  data: Partial<NotificationOutboxItem>;
}

describe('NotificationDispatchScheduler', () => {
  let prisma: {
    notificationOutboxItem: { findMany: jest.Mock; updateMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let emailProvider: { send: jest.Mock };
  let scheduler: NotificationDispatchScheduler;

  function finalizeCalls(): UpdateManyCallArgs[] {
    const calls = prisma.notificationOutboxItem.updateMany.mock
      .calls as unknown as UpdateManyCallArgs[][];
    // The finalize call is identified by carrying `where.claimToken` —
    // the claim call itself uses `where.OR` instead.
    return calls
      .map((call) => call[0])
      .filter(
        (args): args is UpdateManyCallArgs =>
          args !== undefined && args.where.claimToken !== undefined,
      );
  }

  function lastFinalizeArgs(): UpdateManyCallArgs {
    const args = finalizeCalls().at(-1);
    if (!args) throw new Error('no finalize updateMany call was made');
    return args;
  }

  beforeEach(() => {
    prisma = {
      notificationOutboxItem: { findMany: jest.fn(), updateMany: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    emailProvider = { send: jest.fn() };
    scheduler = new NotificationDispatchScheduler(
      prisma as unknown as PrismaService,
      emailProvider as unknown as EmailProviderService,
    );
  });

  it('sends a PENDING item and marks it SENT', async () => {
    prisma.notificationOutboxItem.findMany.mockResolvedValue([buildItem()]);
    prisma.notificationOutboxItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ email: 'user@example.com' });
    emailProvider.send.mockResolvedValue(undefined);

    await scheduler.dispatchPending();

    expect(emailProvider.send).toHaveBeenCalledWith(
      'user@example.com',
      expect.any(String),
      expect.any(String),
    );
    expect(lastFinalizeArgs().data.status).toBe(NotificationStatus.SENT);
  });

  it('claims each candidate before sending — a claim that matches zero rows is skipped entirely', async () => {
    prisma.notificationOutboxItem.findMany.mockResolvedValue([buildItem()]);
    prisma.notificationOutboxItem.updateMany.mockResolvedValue({ count: 0 });

    await scheduler.dispatchPending();

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(finalizeCalls()).toHaveLength(0);
  });

  it('increments attempts and records the error on a transient failure without marking FAILED', async () => {
    prisma.notificationOutboxItem.findMany.mockResolvedValue([buildItem({ attempts: 1 })]);
    prisma.notificationOutboxItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ email: 'user@example.com' });
    emailProvider.send.mockRejectedValue(new Error('SMTP unconfigured'));

    await scheduler.dispatchPending();

    const args = lastFinalizeArgs();
    expect(args.data.status).toBe(NotificationStatus.PENDING);
    expect(args.data.attempts).toBe(2);
    expect(args.data.lastError).toBe('SMTP unconfigured');
  });

  it('permanently marks FAILED after reaching the max attempt count', async () => {
    prisma.notificationOutboxItem.findMany.mockResolvedValue([buildItem({ attempts: 4 })]);
    prisma.notificationOutboxItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ email: 'user@example.com' });
    emailProvider.send.mockRejectedValue(new Error('still failing'));

    await scheduler.dispatchPending();

    const args = lastFinalizeArgs();
    expect(args.data.status).toBe(NotificationStatus.FAILED);
    expect(args.data.attempts).toBe(5);
  });

  it('marks an item with no resolvable recipient permanently FAILED rather than retrying forever', async () => {
    prisma.notificationOutboxItem.findMany.mockResolvedValue([buildItem()]);
    prisma.notificationOutboxItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue(null);

    await scheduler.dispatchPending();

    expect(lastFinalizeArgs().data.status).toBe(NotificationStatus.FAILED);
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it('a dispatch failure for one item never prevents the batch from continuing', async () => {
    prisma.notificationOutboxItem.findMany.mockResolvedValue([
      buildItem({ id: 'item-1' }),
      buildItem({ id: 'item-2' }),
    ]);
    prisma.notificationOutboxItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ email: 'user@example.com' });
    emailProvider.send
      .mockRejectedValueOnce(new Error('fail once'))
      .mockResolvedValueOnce(undefined);

    await scheduler.dispatchPending();

    expect(finalizeCalls()).toHaveLength(2);
  });

  describe('concurrent dispatchers (multi-instance safety, Correction 4)', () => {
    it('two concurrent dispatchPending() calls send the same PENDING item only once', async () => {
      const { prisma: fakePrisma } = buildFakePrisma([buildItem()]);
      const concurrentScheduler = new NotificationDispatchScheduler(
        fakePrisma as unknown as PrismaService,
        emailProvider as unknown as EmailProviderService,
      );
      emailProvider.send.mockResolvedValue(undefined);

      await Promise.all([
        concurrentScheduler.dispatchPending(),
        concurrentScheduler.dispatchPending(),
      ]);

      expect(emailProvider.send).toHaveBeenCalledTimes(1);
    });

    it('a stale (crashed) SENDING claim is reclaimable after the stale window', async () => {
      const staleItem = buildItem({
        status: NotificationStatus.SENDING,
        claimedAt: new Date(Date.now() - 5 * 60_000),
      });
      const { prisma: fakePrisma, items } = buildFakePrisma([staleItem]);
      const concurrentScheduler = new NotificationDispatchScheduler(
        fakePrisma as unknown as PrismaService,
        emailProvider as unknown as EmailProviderService,
      );
      emailProvider.send.mockResolvedValue(undefined);

      await concurrentScheduler.dispatchPending();

      expect(emailProvider.send).toHaveBeenCalledTimes(1);
      expect(items.get('item-1')?.status).toBe(NotificationStatus.SENT);
    });

    it('a fresh (not-yet-stale) SENDING claim held by another instance is left alone', async () => {
      const freshItem = buildItem({ status: NotificationStatus.SENDING, claimedAt: new Date() });
      const { prisma: fakePrisma } = buildFakePrisma([freshItem]);
      const concurrentScheduler = new NotificationDispatchScheduler(
        fakePrisma as unknown as PrismaService,
        emailProvider as unknown as EmailProviderService,
      );

      await concurrentScheduler.dispatchPending();

      expect(emailProvider.send).not.toHaveBeenCalled();
    });
  });

  describe("fencing (Correction 4) — a stale dispatcher cannot overwrite a newer claim's outcome", () => {
    it("a slow send that completes after the item was reclaimed does not clobber the reclaiming instance's result", async () => {
      const item = buildItem({
        status: NotificationStatus.SENDING,
        claimedAt: new Date(Date.now() - 5 * 60_000),
      });
      const { prisma: fakePrisma, items } = buildFakePrisma([item]);
      const concurrentScheduler = new NotificationDispatchScheduler(
        fakePrisma as unknown as PrismaService,
        emailProvider as unknown as EmailProviderService,
      );

      // Instance A's send is slow; while it's in flight, simulate instance
      // B reclaiming the stale item and successfully sending it first —
      // mutating the item's claim exactly as a real reclaim would.
      emailProvider.send.mockImplementation(() => {
        const row = items.get('item-1')!;
        row.claimToken = 'instance-b-token';
        row.status = NotificationStatus.SENT;
        return Promise.resolve();
      });

      await concurrentScheduler.dispatchPending();

      // Instance A's own finalize call used its own (now-stale) token —
      // it must not have overwritten instance B's SENT outcome.
      expect(items.get('item-1')?.status).toBe(NotificationStatus.SENT);
      expect(items.get('item-1')?.claimToken).toBe('instance-b-token');
    });
  });
});
