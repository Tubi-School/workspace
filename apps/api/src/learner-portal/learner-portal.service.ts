import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
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
      select: { sessionId: true },
    });
    const sessionIds = snapshots.map((snapshot) => snapshot.sessionId);

    if (sessionIds.length === 0) {
      return [];
    }

    return this.prisma.session.findMany({
      where: { id: { in: sessionIds } },
      include: sessionInclude,
      orderBy: { startTime: 'asc' },
    });
  }

  async getEntitledSession(learnerId: string, sessionId: string): Promise<LearnerVisibleSession> {
    const snapshot = await this.prisma.sessionEntitlementSnapshot.findUnique({
      where: { sessionId_learnerId: { sessionId, learnerId } },
    });

    if (!snapshot || !snapshot.wasEntitled) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    return this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      include: sessionInclude,
    });
  }
}
