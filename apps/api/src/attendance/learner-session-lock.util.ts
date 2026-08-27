import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Runs `fn` inside a Postgres transaction that first takes a
 * transaction-scoped advisory lock keyed by (sessionId, learnerId).
 *
 * This is the smallest robust fix for the interval-ingestion concurrency
 * gap identified in the Phase 2F external review: without it, two
 * concurrent ingest() calls for the same learner+session could each read
 * the prior interval set before the other's just-inserted row committed,
 * silently under-counting coverage. `pg_advisory_xact_lock` serializes
 * only requests that collide on the same (sessionId, learnerId) pair —
 * unrelated learners and sessions never contend — and the lock is released
 * automatically when the transaction commits or rolls back, so no manual
 * unlock/cleanup path is needed. No schema change is required: advisory
 * locks are a session-level Postgres primitive, not a table.
 *
 * `hashtext(...)::bigint` folds the composite key into the single bigint
 * `pg_advisory_xact_lock` takes. A hash collision between two different
 * (sessionId, learnerId) pairs would only ever cause extra, harmless
 * serialization (never incorrect data), so no collision-avoidance beyond
 * hashtext's own distribution is needed here.
 */
export async function withLearnerSessionLock<T>(
  prisma: PrismaService,
  sessionId: string,
  learnerId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const lockKey = `${sessionId}:${learnerId}`;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
    return fn(tx);
  });
}
