import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { DeliveryMode, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const sessionInclude = {
  course: true,
  recording: true,
} satisfies Prisma.SessionInclude;

export type LearnerVisibleSession = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

/**
 * Learner-facing session access (Part D). Every method here takes the
 * caller's LearnerProfile id — resolved from the authenticated User by the
 * controller, never accepted as client input — and every read is filtered
 * through SessionEntitlementSnapshot.wasEntitled, so a learner can only
 * ever see sessions they were actually, historically entitled to. A
 * session that exists but the caller isn't entitled to reads as 404, not
 * 403 — its existence is not something to confirm to a caller with no
 * relationship to it.
 */
@Injectable()
export class LearnerPortalService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveLearnerProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.learnerProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new ForbiddenException('No learner profile is associated with this account');
    }

    return profile.id;
  }

  async listEntitledSessions(learnerId: string): Promise<LearnerVisibleSession[]> {
    const snapshots = await this.prisma.sessionEntitlementSnapshot.findMany({
      where: { learnerId, wasEntitled: true },
      select: { sessionId: true, subscriptionAccess: { select: { offering: true } } },
    });

    if (snapshots.length === 0) {
      return [];
    }

    const deliveryModeBySessionId = new Map(
      snapshots.map((snapshot) => [
        snapshot.sessionId,
        snapshot.subscriptionAccess?.offering.deliveryMode ?? null,
      ]),
    );

    const sessions = await this.prisma.session.findMany({
      where: { id: { in: [...deliveryModeBySessionId.keys()] } },
      include: sessionInclude,
      orderBy: { startTime: 'asc' },
    });

    return sessions.map((session) =>
      redactLiveAccess(session, deliveryModeBySessionId.get(session.id) ?? null),
    );
  }

  async getEntitledSession(learnerId: string, sessionId: string): Promise<LearnerVisibleSession> {
    const snapshot = await this.prisma.sessionEntitlementSnapshot.findUnique({
      where: { sessionId_learnerId: { sessionId, learnerId } },
      include: { subscriptionAccess: { select: { offering: true } } },
    });

    if (!snapshot || !snapshot.wasEntitled) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      include: sessionInclude,
    });

    return redactLiveAccess(session, snapshot.subscriptionAccess?.offering.deliveryMode ?? null);
  }
}

/**
 * A learner must not gain learner-facing LIVE functionality (the raw
 * liveMeetingUrl) merely because the same Session also carries one, and
 * FAILS CLOSED (Phase 2G Correction 3): `liveMeetingUrl` is redacted
 * unless `deliveryMode` is AFFIRMATIVELY `LIVE_AND_RECORDED`. A
 * RECORDED_ONLY offering redacts it, exactly as before; a `null`
 * deliveryMode — the entitlement snapshot has no resolvable
 * SubscriptionAccess/Offering to read a mode from — also redacts it,
 * rather than being silently promoted to the permissive default. This
 * never creates a second Session for a redacted learner — it is the same
 * row with one field redacted for this caller's response only.
 */
function redactLiveAccess(
  session: LearnerVisibleSession,
  deliveryMode: DeliveryMode | null,
): LearnerVisibleSession {
  if (deliveryMode === DeliveryMode.LIVE_AND_RECORDED) {
    return session;
  }

  return { ...session, liveMeetingUrl: '' };
}
