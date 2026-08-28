import { Prisma, WebhookEventStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WebhookIdempotencyService } from './webhook-idempotency.service.js';

/**
 * Phase 4 external review Corrections 1 and 2 — proves both that the
 * RECEIVED/PROCESSING/PROCESSED state machine closes the "claim-before-
 * processing poison event" gap, AND that per-claim token fencing stops a
 * stale worker (one whose claim was reclaimed after the stale window)
 * from ever mutating a newer worker's claim state.
 */
describe('WebhookIdempotencyService', () => {
  function buildInMemoryPrisma() {
    const rows = new Map<
      string,
      { status: WebhookEventStatus; claimedAt: Date | null; claimToken: string | null }
    >();

    const prisma = {
      providerWebhookEvent: {
        create: jest.fn(
          ({
            data,
          }: {
            data: { provider: string; externalEventId: string; status: WebhookEventStatus };
          }) => {
            const key = `${data.provider}:${data.externalEventId}`;
            if (rows.has(key)) {
              throw new Prisma.PrismaClientKnownRequestError('duplicate', {
                code: 'P2002',
                clientVersion: 'test',
              });
            }
            rows.set(key, { status: data.status, claimedAt: null, claimToken: null });
            return Promise.resolve({});
          },
        ),
        findUnique: jest.fn(
          ({
            where,
          }: {
            where: { provider_externalEventId: { provider: string; externalEventId: string } };
          }) => {
            const key = `${where.provider_externalEventId.provider}:${where.provider_externalEventId.externalEventId}`;
            const row = rows.get(key);
            return Promise.resolve(row ? { ...row } : null);
          },
        ),
        updateMany: jest.fn(
          (args: {
            where: {
              provider: string;
              externalEventId: string;
              OR?: Array<{ status: WebhookEventStatus; claimedAt?: { lt: Date } }>;
              claimToken?: string;
              status?: WebhookEventStatus;
            };
            data: Partial<{
              status: WebhookEventStatus;
              claimedAt: Date | null;
              claimToken: string | null;
              processedAt: Date;
            }>;
          }) => {
            const { where, data } = args;
            const key = `${where.provider}:${where.externalEventId}`;
            const row = rows.get(key);
            if (!row) return Promise.resolve({ count: 0 });

            let matches: boolean;
            if (where.OR) {
              matches = where.OR.some((clause) => {
                if (clause.status !== row.status) return false;
                if (clause.claimedAt) {
                  return (
                    row.claimedAt !== null &&
                    row.claimedAt.getTime() < clause.claimedAt.lt.getTime()
                  );
                }
                return true;
              });
            } else {
              matches = row.claimToken === where.claimToken && row.status === where.status;
            }

            if (!matches) return Promise.resolve({ count: 0 });

            Object.assign(row, data);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
    };

    return { prisma, rows };
  }

  it('claims the first delivery of an event id (PROCEED) with a fresh token', async () => {
    const { prisma } = buildInMemoryPrisma();
    const service = new WebhookIdempotencyService(prisma as unknown as PrismaService);

    const result = await service.claim('ZOOM', 'evt-1', 'meeting.participant_joined');

    expect(result.outcome).toBe('PROCEED');
    expect(result).toHaveProperty('token');
  });

  it('an already-successfully-processed event remains a safe no-op forever', async () => {
    const { prisma } = buildInMemoryPrisma();
    const service = new WebhookIdempotencyService(prisma as unknown as PrismaService);

    const claim = await service.claim('ZOOM', 'evt-1', 'x');
    if (claim.outcome !== 'PROCEED') throw new Error('expected PROCEED');
    await service.markProcessed('ZOOM', 'evt-1', claim.token);

    await expect(service.claim('ZOOM', 'evt-1', 'x')).resolves.toEqual({
      outcome: 'ALREADY_PROCESSED',
    });
    await expect(service.claim('ZOOM', 'evt-1', 'x')).resolves.toEqual({
      outcome: 'ALREADY_PROCESSED',
    });
  });

  it('a failed first processing attempt can be completed by a retry (never permanently poisoned)', async () => {
    const { prisma } = buildInMemoryPrisma();
    const service = new WebhookIdempotencyService(prisma as unknown as PrismaService);

    const first = await service.claim('ZOOM', 'evt-1', 'x');
    if (first.outcome !== 'PROCEED') throw new Error('expected PROCEED');
    await service.markFailed('ZOOM', 'evt-1', first.token);

    const retry = await service.claim('ZOOM', 'evt-1', 'x');
    expect(retry.outcome).toBe('PROCEED');
    if (retry.outcome !== 'PROCEED') throw new Error('expected PROCEED');
    await service.markProcessed('ZOOM', 'evt-1', retry.token);

    await expect(service.claim('ZOOM', 'evt-1', 'x')).resolves.toEqual({
      outcome: 'ALREADY_PROCESSED',
    });
  });

  it('two simultaneous deliveries only let one caller proceed — the other is told another caller has it', async () => {
    const { prisma } = buildInMemoryPrisma();
    const service = new WebhookIdempotencyService(prisma as unknown as PrismaService);

    const [first, second] = await Promise.all([
      service.claim('ZOOM', 'evt-1', 'x'),
      service.claim('ZOOM', 'evt-1', 'x'),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(['CLAIMED_BY_OTHER', 'PROCEED']);
  });

  it('a crash that leaves an event PROCESSING is reclaimable once the stale window elapses', async () => {
    const { prisma, rows } = buildInMemoryPrisma();
    const service = new WebhookIdempotencyService(prisma as unknown as PrismaService);

    await service.claim('ZOOM', 'evt-1', 'x'); // claims PROCESSING, then "crashes" — never marks processed/failed

    // Still within the window: a retry must not reprocess concurrently.
    await expect(service.claim('ZOOM', 'evt-1', 'x')).resolves.toEqual({
      outcome: 'CLAIMED_BY_OTHER',
    });

    // Simulate the stale window having elapsed.
    const row = rows.get('ZOOM:evt-1')!;
    row.claimedAt = new Date(Date.now() - 5 * 60_000);

    await expect(service.claim('ZOOM', 'evt-1', 'x')).resolves.toMatchObject({
      outcome: 'PROCEED',
    });
  });

  describe("fencing (Correction 2) — a stale worker cannot clobber a newer worker's claim", () => {
    it('a stale worker cannot mark PROCESSED after another worker reclaimed the event', async () => {
      const { prisma, rows } = buildInMemoryPrisma();
      const service = new WebhookIdempotencyService(prisma as unknown as PrismaService);

      const staleWorkerClaim = await service.claim('ZOOM', 'evt-1', 'x');
      if (staleWorkerClaim.outcome !== 'PROCEED') throw new Error('expected PROCEED');

      // Simulate worker A going stale and worker B reclaiming the event.
      const row = rows.get('ZOOM:evt-1')!;
      row.claimedAt = new Date(Date.now() - 5 * 60_000);
      const newWorkerClaim = await service.claim('ZOOM', 'evt-1', 'x');
      if (newWorkerClaim.outcome !== 'PROCEED') throw new Error('expected PROCEED');
      expect(newWorkerClaim.token).not.toBe(staleWorkerClaim.token);

      // Worker A (stale, using its old token) finally finishes and calls
      // markProcessed — this must NOT affect worker B's active claim.
      await service.markProcessed('ZOOM', 'evt-1', staleWorkerClaim.token);

      expect(row.status).toBe(WebhookEventStatus.PROCESSING);
      expect(row.claimToken).toBe(newWorkerClaim.token);
    });

    it("a stale worker cannot revert a newer worker's successful processing back to RECEIVED", async () => {
      const { prisma, rows } = buildInMemoryPrisma();
      const service = new WebhookIdempotencyService(prisma as unknown as PrismaService);

      const staleWorkerClaim = await service.claim('ZOOM', 'evt-1', 'x');
      if (staleWorkerClaim.outcome !== 'PROCEED') throw new Error('expected PROCEED');

      const row = rows.get('ZOOM:evt-1')!;
      row.claimedAt = new Date(Date.now() - 5 * 60_000);
      const newWorkerClaim = await service.claim('ZOOM', 'evt-1', 'x');
      if (newWorkerClaim.outcome !== 'PROCEED') throw new Error('expected PROCEED');
      await service.markProcessed('ZOOM', 'evt-1', newWorkerClaim.token);

      // Worker A (stale) finally fails and calls markFailed with its old
      // token — must NOT revert worker B's completed PROCESSED state.
      await service.markFailed('ZOOM', 'evt-1', staleWorkerClaim.token);

      expect(row.status).toBe(WebhookEventStatus.PROCESSED);
    });

    it('markProcessed/markFailed with a stale token never throws — it logs and no-ops', async () => {
      const { prisma } = buildInMemoryPrisma();
      const service = new WebhookIdempotencyService(prisma as unknown as PrismaService);

      const claim = await service.claim('ZOOM', 'evt-1', 'x');
      if (claim.outcome !== 'PROCEED') throw new Error('expected PROCEED');
      await service.markProcessed('ZOOM', 'evt-1', claim.token);

      await expect(service.markProcessed('ZOOM', 'evt-1', 'wrong-token')).resolves.toBeUndefined();
      await expect(service.markFailed('ZOOM', 'evt-1', 'wrong-token')).resolves.toBeUndefined();
    });
  });

  it('propagates an unrelated database error from the initial insert', async () => {
    const prisma = {
      providerWebhookEvent: { create: jest.fn().mockRejectedValue(new Error('down')) },
    };
    const service = new WebhookIdempotencyService(prisma as unknown as PrismaService);

    await expect(service.claim('ZOOM', 'evt-1', 'x')).rejects.toThrow('down');
  });
});
