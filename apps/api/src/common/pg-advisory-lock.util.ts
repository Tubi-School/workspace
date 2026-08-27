import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Runs `fn` inside a Postgres transaction that first takes a
 * transaction-scoped advisory lock keyed by `lockKey`.
 *
 * Generic building block behind two Phase 2F/2G concurrency fixes:
 * interval-ingestion serialization (attendance/learner-session-lock.util.ts)
 * and the SubscriptionAccess overlapping-grant race (Phase 2G Correction A).
 * `pg_advisory_xact_lock` serializes only callers who collide on the same
 * key; unrelated keys never contend, and the lock releases automatically
 * when the transaction commits or rolls back — no manual unlock/cleanup
 * path is needed, and no schema change is required (advisory locks are a
 * session-level Postgres primitive, not a table).
 *
 * `hashtext(...)::bigint` folds an arbitrary string key into the single
 * bigint `pg_advisory_xact_lock` takes. A hash collision between two
 * different keys would only ever cause extra, harmless serialization
 * (never incorrect data), so no collision-avoidance beyond hashtext's own
 * distribution is needed here.
 */
export async function withAdvisoryLock<T>(
  prisma: PrismaService,
  lockKey: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
    return fn(tx);
  });
}
