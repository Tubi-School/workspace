import { Injectable } from '@nestjs/common';

import {
  AttendanceStatus,
  SubscriptionStatus,
  type SubscriptionAccess,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The frozen entitlement engine (docs/phase-2a-final-domain-design.txt,
 * sections I and J).
 *
 * Every operation here is idempotent by construction — `upsert` on the
 * unique (sessionId, learnerId) constraints already present on
 * SessionEntitlementSnapshot and AttendanceRecord — so calling it more than
 * once for the same session (a retry, a race between two admins, a future
 * scheduler firing twice) never creates a duplicate row or changes an
 * already-recorded entitlement decision. A snapshot is historical truth:
 * once written, this service never overwrites `wasEntitled` or
 * `subscriptionAccessId` on an existing row — `update: {}` in every upsert
 * below is a deliberate no-op, not an oversight.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates "normal" entitlement for a session at `entitlementPoint` —
   * the moment the frozen design calls the session's entitlement point
   * (MIN(session.startTime, session.canceledAt), approximated here by the
   * real system event that triggers evaluation: the session going LIVE, or
   * being canceled before it ever did — see SessionsService.markLive and
   * SessionsService.cancel).
   *
   * For every learner holding an ACTIVE SubscriptionAccess, for an
   * Offering that covers this session's Course, whose period covers
   * `entitlementPoint`, this writes a SessionEntitlementSnapshot
   * (wasEntitled: true) and idempotently ensures a PENDING AttendanceRecord
   * exists — so a learner who never interacts with the session at all can
   * still later be finalized ABSENT (Part J of the Phase 2F brief).
   */
  async evaluateForSession(sessionId: string, entitlementPoint: Date): Promise<void> {
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { courseId: true },
    });

    const offeringLinks = await this.prisma.offeringCourse.findMany({
      where: { courseId: session.courseId },
      select: { offeringId: true },
    });
    const offeringIds = offeringLinks.map((link) => link.offeringId);

    if (offeringIds.length === 0) {
      return;
    }

    const grants = await this.prisma.subscriptionAccess.findMany({
      where: {
        offeringId: { in: offeringIds },
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: { lte: entitlementPoint },
        currentPeriodEnd: { gte: entitlementPoint },
      },
    });

    // A learner may hold more than one qualifying grant (e.g. two
    // overlapping offerings covering the same course); one snapshot per
    // learner is still correct — pick the first deterministically.
    const grantByLearner = new Map<string, SubscriptionAccess>();
    for (const grant of grants) {
      if (!grantByLearner.has(grant.learnerId)) {
        grantByLearner.set(grant.learnerId, grant);
      }
    }

    for (const [learnerId, grant] of grantByLearner) {
      await this.writeEntitlementAndPendingAttendance(sessionId, learnerId, {
        subscriptionAccessId: grant.id,
        snapshotAt: entitlementPoint,
        inheritedFromSnapshotId: null,
      });
    }
  }

  /**
   * Replacement-session entitlement inheritance (frozen design section J).
   *
   * For every learner entitled to the canceled `originalSessionId`, copies
   * that entitlement onto `replacementSessionId` — never recalculated from
   * today's subscription state — with `inheritedFromSnapshotId` pointing at
   * the immediate predecessor's snapshot. This is what lets a multi-hop
   * replacement chain (Original -> Replacement A -> Replacement B) stay
   * traceable: each snapshot links only to its direct parent, and the full
   * ancestry is recovered by walking the chain.
   */
  async inheritForReplacement(
    originalSessionId: string,
    replacementSessionId: string,
  ): Promise<void> {
    const originalSnapshots = await this.prisma.sessionEntitlementSnapshot.findMany({
      where: { sessionId: originalSessionId, wasEntitled: true },
    });

    for (const snapshot of originalSnapshots) {
      await this.writeEntitlementAndPendingAttendance(replacementSessionId, snapshot.learnerId, {
        subscriptionAccessId: snapshot.subscriptionAccessId,
        snapshotAt: new Date(),
        inheritedFromSnapshotId: snapshot.id,
      });
    }
  }

  private async writeEntitlementAndPendingAttendance(
    sessionId: string,
    learnerId: string,
    fields: {
      subscriptionAccessId: string | null;
      snapshotAt: Date;
      inheritedFromSnapshotId: string | null;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.sessionEntitlementSnapshot.upsert({
        where: { sessionId_learnerId: { sessionId, learnerId } },
        update: {},
        create: {
          sessionId,
          learnerId,
          wasEntitled: true,
          subscriptionAccessId: fields.subscriptionAccessId,
          snapshotAt: fields.snapshotAt,
          inheritedFromSnapshotId: fields.inheritedFromSnapshotId,
        },
      });

      await tx.attendanceRecord.upsert({
        where: { sessionId_learnerId: { sessionId, learnerId } },
        update: {},
        create: { sessionId, learnerId, status: AttendanceStatus.PENDING },
      });
    });
  }
}
