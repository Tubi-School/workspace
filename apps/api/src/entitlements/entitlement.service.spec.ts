// `expect.objectContaining` is typed `any` by @types/jest; every assertion
// below is fully type-safe about what it actually checks.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { SubscriptionStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { EntitlementService } from './entitlement.service.js';

const SESSION_ID = 'session-1';
const COURSE_ID = 'course-1';
const OFFERING_ID = 'offering-1';
const LEARNER_ID = 'learner-1';
const GRANT_ID = 'grant-1';

describe('EntitlementService', () => {
  let prisma: {
    session: { findUniqueOrThrow: jest.Mock };
    offeringCourse: { findMany: jest.Mock };
    subscriptionAccess: { findMany: jest.Mock };
    sessionEntitlementSnapshot: { upsert: jest.Mock; findMany: jest.Mock };
    attendanceRecord: { upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: EntitlementService;

  function buildGrant(overrides: Record<string, unknown> = {}) {
    return {
      id: GRANT_ID,
      learnerId: LEARNER_ID,
      offeringId: OFFERING_ID,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-12-31'),
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      session: { findUniqueOrThrow: jest.fn().mockResolvedValue({ courseId: COURSE_ID }) },
      offeringCourse: { findMany: jest.fn().mockResolvedValue([{ offeringId: OFFERING_ID }]) },
      subscriptionAccess: { findMany: jest.fn() },
      sessionEntitlementSnapshot: { upsert: jest.fn(), findMany: jest.fn() },
      attendanceRecord: { upsert: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    service = new EntitlementService(prisma as unknown as PrismaService);
  });

  describe('evaluateForSession', () => {
    it('creates a snapshot and a PENDING attendance record for a learner with a valid ACTIVE grant', async () => {
      prisma.subscriptionAccess.findMany.mockResolvedValue([buildGrant()]);

      await service.evaluateForSession(SESSION_ID, new Date('2026-06-01'));

      expect(prisma.sessionEntitlementSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId_learnerId: { sessionId: SESSION_ID, learnerId: LEARNER_ID } },
          create: expect.objectContaining({
            sessionId: SESSION_ID,
            learnerId: LEARNER_ID,
            wasEntitled: true,
            subscriptionAccessId: GRANT_ID,
          }),
        }),
      );
      expect(prisma.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId_learnerId: { sessionId: SESSION_ID, learnerId: LEARNER_ID } },
          create: expect.objectContaining({
            sessionId: SESSION_ID,
            learnerId: LEARNER_ID,
            status: 'PENDING',
          }),
        }),
      );
    });

    it('produces no snapshot for a learner with no qualifying grant (query already filters by period/status)', async () => {
      prisma.subscriptionAccess.findMany.mockResolvedValue([]);

      await service.evaluateForSession(SESSION_ID, new Date('2026-06-01'));

      expect(prisma.sessionEntitlementSnapshot.upsert).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.upsert).not.toHaveBeenCalled();
    });

    it('queries only ACTIVE grants whose period covers the entitlement point', async () => {
      prisma.subscriptionAccess.findMany.mockResolvedValue([]);
      const entitlementPoint = new Date('2026-06-01');

      await service.evaluateForSession(SESSION_ID, entitlementPoint);

      expect(prisma.subscriptionAccess.findMany).toHaveBeenCalledWith({
        where: {
          offeringId: { in: [OFFERING_ID] },
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: { lte: entitlementPoint },
          currentPeriodEnd: { gte: entitlementPoint },
        },
      });
    });

    it('is idempotent: calling it twice for the same session upserts (never duplicates) the same row', async () => {
      prisma.subscriptionAccess.findMany.mockResolvedValue([buildGrant()]);

      await service.evaluateForSession(SESSION_ID, new Date('2026-06-01'));
      await service.evaluateForSession(SESSION_ID, new Date('2026-06-01'));

      expect(prisma.sessionEntitlementSnapshot.upsert).toHaveBeenCalledTimes(2);
      const calls = prisma.sessionEntitlementSnapshot.upsert.mock.calls as unknown as {
        update: Record<string, unknown>;
      }[][];
      // Both calls must use a no-op `update` — an existing snapshot's
      // wasEntitled/subscriptionAccessId is never overwritten.
      expect(calls[0]?.[0]?.update).toEqual({});
      expect(calls[1]?.[0]?.update).toEqual({});
    });

    it('does nothing when the course is covered by no Offering at all', async () => {
      prisma.offeringCourse.findMany.mockResolvedValue([]);

      await service.evaluateForSession(SESSION_ID, new Date('2026-06-01'));

      expect(prisma.subscriptionAccess.findMany).not.toHaveBeenCalled();
    });
  });

  describe('inheritForReplacement', () => {
    it('copies every wasEntitled snapshot from the original session onto the replacement, linking inheritedFromSnapshotId', async () => {
      prisma.sessionEntitlementSnapshot.findMany.mockResolvedValue([
        {
          id: 'original-snapshot-1',
          learnerId: LEARNER_ID,
          subscriptionAccessId: GRANT_ID,
          wasEntitled: true,
        },
      ]);

      await service.inheritForReplacement('original-session', 'replacement-session');

      expect(prisma.sessionEntitlementSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sessionId_learnerId: { sessionId: 'replacement-session', learnerId: LEARNER_ID },
          },
          create: expect.objectContaining({
            sessionId: 'replacement-session',
            learnerId: LEARNER_ID,
            wasEntitled: true,
            subscriptionAccessId: GRANT_ID,
            inheritedFromSnapshotId: 'original-snapshot-1',
          }),
        }),
      );
      // A PENDING attendance record follows the inherited entitlement too.
      expect(prisma.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            sessionId: 'replacement-session',
            learnerId: LEARNER_ID,
          }),
        }),
      );
    });

    it('preserves inheritance across a multi-generation chain (each link points only to its immediate parent)', async () => {
      // Replacement B inherits from Replacement A's snapshot, not the
      // original's — the chain itself provides transitive traceability.
      prisma.sessionEntitlementSnapshot.findMany.mockResolvedValue([
        {
          id: 'replacement-a-snapshot',
          learnerId: LEARNER_ID,
          subscriptionAccessId: GRANT_ID,
          wasEntitled: true,
          inheritedFromSnapshotId: 'original-snapshot-1',
        },
      ]);

      await service.inheritForReplacement('replacement-a-session', 'replacement-b-session');

      expect(prisma.sessionEntitlementSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ inheritedFromSnapshotId: 'replacement-a-snapshot' }),
        }),
      );
    });

    it('does not inherit entitlement the original session never had (wasEntitled: false rows excluded by query)', async () => {
      prisma.sessionEntitlementSnapshot.findMany.mockResolvedValue([]);

      await service.inheritForReplacement('original-session', 'replacement-session');

      expect(prisma.sessionEntitlementSnapshot.upsert).not.toHaveBeenCalled();
    });

    it('ignores whether the subscription behind the inherited grant has since expired — copies the historical snapshot as-is', async () => {
      // The service does not re-check SubscriptionAccess.status/period at
      // all during inheritance; it only reads the original session's
      // already-frozen snapshot rows. This test documents that the
      // inherited subscriptionAccessId is carried over unconditionally.
      prisma.sessionEntitlementSnapshot.findMany.mockResolvedValue([
        {
          id: 'original-snapshot-1',
          learnerId: LEARNER_ID,
          subscriptionAccessId: GRANT_ID,
          wasEntitled: true,
        },
      ]);

      await service.inheritForReplacement('original-session', 'replacement-session');

      expect(prisma.subscriptionAccess.findMany).not.toHaveBeenCalled();
      expect(prisma.sessionEntitlementSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ wasEntitled: true }) }),
      );
    });
  });
});
