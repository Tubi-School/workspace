import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service.js';
import { LearnerPortalService } from './learner-portal.service.js';

const SESSION_ID = 'session-1';
const LEARNER_ID = 'learner-1';

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    liveMeetingUrl: 'https://meet.example.com/room',
    course: { id: 'course-1' },
    recording: null,
    ...overrides,
  };
}

describe('LearnerPortalService', () => {
  let prisma: {
    learnerProfile: { findUnique: jest.Mock };
    sessionEntitlementSnapshot: { findMany: jest.Mock; findUnique: jest.Mock };
    session: { findMany: jest.Mock; findUniqueOrThrow: jest.Mock };
  };
  let service: LearnerPortalService;

  beforeEach(() => {
    prisma = {
      learnerProfile: { findUnique: jest.fn() },
      sessionEntitlementSnapshot: { findMany: jest.fn(), findUnique: jest.fn() },
      session: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    };
    service = new LearnerPortalService(prisma as unknown as PrismaService);
  });

  describe('resolveLearnerProfileId', () => {
    it('resolves the LearnerProfile id for the given user', async () => {
      prisma.learnerProfile.findUnique.mockResolvedValue({ id: LEARNER_ID });

      await expect(service.resolveLearnerProfileId('user-1')).resolves.toBe(LEARNER_ID);
    });

    it('rejects an account with no LearnerProfile', async () => {
      prisma.learnerProfile.findUnique.mockResolvedValue(null);

      await expect(service.resolveLearnerProfileId('user-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('getEntitledSession — DeliveryMode redaction', () => {
    it('rejects a session the learner is not entitled to with 404', async () => {
      prisma.sessionEntitlementSnapshot.findUnique.mockResolvedValue(null);

      await expect(service.getEntitledSession(LEARNER_ID, SESSION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('exposes liveMeetingUrl unchanged for a LIVE_AND_RECORDED entitlement', async () => {
      prisma.sessionEntitlementSnapshot.findUnique.mockResolvedValue({
        wasEntitled: true,
        subscriptionAccess: { offering: { deliveryMode: 'LIVE_AND_RECORDED' } },
      });
      prisma.session.findUniqueOrThrow.mockResolvedValue(buildSession());

      const result = await service.getEntitledSession(LEARNER_ID, SESSION_ID);

      expect(result.liveMeetingUrl).toBe('https://meet.example.com/room');
    });

    it('redacts liveMeetingUrl for a RECORDED_ONLY entitlement — same Session row, not a second Session', async () => {
      prisma.sessionEntitlementSnapshot.findUnique.mockResolvedValue({
        wasEntitled: true,
        subscriptionAccess: { offering: { deliveryMode: 'RECORDED_ONLY' } },
      });
      prisma.session.findUniqueOrThrow.mockResolvedValue(buildSession());

      const result = await service.getEntitledSession(LEARNER_ID, SESSION_ID);

      expect(result.liveMeetingUrl).toBe('');
      expect(result.id).toBe(SESSION_ID);
      expect(prisma.session.findMany).not.toHaveBeenCalled();
    });

    it('FAILS CLOSED: redacts liveMeetingUrl if a snapshot has no linked subscriptionAccess/offering to resolve a DeliveryMode from (Phase 2G Correction 3)', async () => {
      prisma.sessionEntitlementSnapshot.findUnique.mockResolvedValue({
        wasEntitled: true,
        subscriptionAccess: null,
      });
      prisma.session.findUniqueOrThrow.mockResolvedValue(buildSession());

      const result = await service.getEntitledSession(LEARNER_ID, SESSION_ID);

      expect(result.liveMeetingUrl).toBe('');
    });
  });

  describe('listEntitledSessions — DeliveryMode redaction', () => {
    it('returns an empty list when the learner holds no entitlement snapshots', async () => {
      prisma.sessionEntitlementSnapshot.findMany.mockResolvedValue([]);

      await expect(service.listEntitledSessions(LEARNER_ID)).resolves.toEqual([]);
      expect(prisma.session.findMany).not.toHaveBeenCalled();
    });

    it('redacts liveMeetingUrl per-session according to each session entitlement snapshot delivery mode', async () => {
      prisma.sessionEntitlementSnapshot.findMany.mockResolvedValue([
        {
          sessionId: 'session-live',
          subscriptionAccess: { offering: { deliveryMode: 'LIVE_AND_RECORDED' } },
        },
        {
          sessionId: 'session-recorded',
          subscriptionAccess: { offering: { deliveryMode: 'RECORDED_ONLY' } },
        },
      ]);
      prisma.session.findMany.mockResolvedValue([
        buildSession({ id: 'session-live' }),
        buildSession({ id: 'session-recorded' }),
      ]);

      const result = await service.listEntitledSessions(LEARNER_ID);

      const liveSession = result.find((session) => session.id === 'session-live')!;
      const recordedSession = result.find((session) => session.id === 'session-recorded')!;
      expect(liveSession.liveMeetingUrl).toBe('https://meet.example.com/room');
      expect(recordedSession.liveMeetingUrl).toBe('');
    });

    it('FAILS CLOSED: redacts liveMeetingUrl for a session whose snapshot has no linked subscriptionAccess (Phase 2G Correction 3)', async () => {
      prisma.sessionEntitlementSnapshot.findMany.mockResolvedValue([
        { sessionId: 'session-unresolved', subscriptionAccess: null },
      ]);
      prisma.session.findMany.mockResolvedValue([buildSession({ id: 'session-unresolved' })]);

      const result = await service.listEntitledSessions(LEARNER_ID);

      expect(result[0]!.liveMeetingUrl).toBe('');
    });
  });
});
