import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { withAdvisoryLock } from '../common/pg-advisory-lock.util.js';

/**
 * Runs `fn` inside a Postgres transaction guarded by a transaction-scoped
 * advisory lock keyed by (sessionId, learnerId).
 *
 * This is the fix for the interval-ingestion concurrency gap identified in
 * the Phase 2F external review: without it, two concurrent ingest() calls
 * for the same learner+session could each read the prior interval set
 * before the other's just-inserted row committed, silently under-counting
 * coverage. See pg-advisory-lock.util.ts for the underlying mechanism.
 */
export async function withLearnerSessionLock<T>(
  prisma: PrismaService,
  sessionId: string,
  learnerId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withAdvisoryLock(prisma, `learner-session:${sessionId}:${learnerId}`, fn);
}
