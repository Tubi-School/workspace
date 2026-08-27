import type { PrismaService } from '../prisma/prisma.service.js';
import { withLearnerSessionLock } from './learner-session-lock.util.js';

describe('withLearnerSessionLock', () => {
  let prisma: { $transaction: jest.Mock; $queryRaw: jest.Mock };

  beforeEach(() => {
    prisma = { $transaction: jest.fn(), $queryRaw: jest.fn().mockResolvedValue(undefined) };
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
  });

  it('takes the advisory lock before invoking the callback, inside one transaction', async () => {
    const callOrder: string[] = [];
    prisma.$queryRaw.mockImplementation(() => {
      callOrder.push('lock');
      return Promise.resolve(undefined);
    });

    await withLearnerSessionLock(
      prisma as unknown as PrismaService,
      'session-1',
      'learner-1',
      () => {
        callOrder.push('callback');
        return Promise.resolve('result');
      },
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['lock', 'callback']);
  });

  it('returns the callback result', async () => {
    const result = await withLearnerSessionLock(
      prisma as unknown as PrismaService,
      'session-1',
      'learner-1',
      () => Promise.resolve({ coverage: 42 }),
    );

    expect(result).toEqual({ coverage: 42 });
  });

  it('propagates a callback failure without swallowing it (the transaction rolls back and the lock is released)', async () => {
    await expect(
      withLearnerSessionLock(prisma as unknown as PrismaService, 'session-1', 'learner-1', () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
  });
});
