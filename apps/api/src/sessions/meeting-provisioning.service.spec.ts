import { MeetingProvisioningStatus, SessionStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ZoomProviderService } from '../providers/zoom/zoom-provider.service.js';
import { MeetingProvisioningService } from './meeting-provisioning.service.js';

interface FakeSession {
  id: string;
  status: SessionStatus;
  meetingProvisioningStatus: MeetingProvisioningStatus;
  meetingProvisioningClaimedAt: Date | null;
  meetingProvisioningClaimToken: string | null;
  startTime: Date;
  endTime: Date;
  providerMeetingId?: string | null;
  meetingProvider?: string | null;
  liveMeetingUrl?: string | null;
  meetingProvisioningError?: string | null;
}

/** A tiny in-memory Session row store so both the claim and the finalize
 * conditional `updateMany` calls are evaluated the way Postgres would —
 * needed for genuine concurrency/fencing/cancellation-race tests, not
 * just canned mock returns. */
function buildFakePrisma(
  initialSession: Omit<FakeSession, 'providerMeetingId'> & {
    providerMeetingId?: string | null;
  },
) {
  const session: FakeSession = { providerMeetingId: null, ...initialSession };

  function matchesStatusFilter(
    filter: { in: MeetingProvisioningStatus[] } | MeetingProvisioningStatus,
    value: MeetingProvisioningStatus,
  ): boolean {
    return typeof filter === 'object' && 'in' in filter
      ? filter.in.includes(value)
      : filter === value;
  }

  const prisma = {
    session: {
      updateMany: jest.fn(
        (args: {
          where: {
            id: string;
            status?: { not: SessionStatus };
            OR?: Array<{
              meetingProvisioningStatus?: unknown;
              meetingProvisioningClaimedAt?: { lt: Date };
            }>;
            meetingProvisioningClaimToken?: string;
          };
          data: Partial<FakeSession>;
        }) => {
          const { where, data } = args;
          if (where.id !== session.id) return Promise.resolve({ count: 0 });
          if (where.status && session.status === where.status.not)
            return Promise.resolve({ count: 0 });

          let matches: boolean;
          if (where.OR) {
            matches = where.OR.some((clause) => {
              const statusMatches = clause.meetingProvisioningStatus
                ? matchesStatusFilter(
                    clause.meetingProvisioningStatus as
                      { in: MeetingProvisioningStatus[] } | MeetingProvisioningStatus,
                    session.meetingProvisioningStatus,
                  )
                : true;
              if (!statusMatches) return false;
              if (clause.meetingProvisioningClaimedAt) {
                return (
                  session.meetingProvisioningClaimedAt !== null &&
                  session.meetingProvisioningClaimedAt.getTime() <
                    clause.meetingProvisioningClaimedAt.lt.getTime()
                );
              }
              return true;
            });
          } else if (where.meetingProvisioningClaimToken !== undefined) {
            matches = session.meetingProvisioningClaimToken === where.meetingProvisioningClaimToken;
          } else {
            matches = true;
          }

          if (!matches) return Promise.resolve({ count: 0 });

          Object.assign(session, data);
          return Promise.resolve({ count: 1 });
        },
      ),
      findUnique: jest.fn(() => Promise.resolve({ ...session })),
    },
  };

  return { prisma, session };
}

describe('MeetingProvisioningService', () => {
  let zoom: { createMeeting: jest.Mock; deleteMeeting: jest.Mock };

  function buildService(prisma: unknown): MeetingProvisioningService {
    return new MeetingProvisioningService(
      prisma as PrismaService,
      zoom as unknown as ZoomProviderService,
    );
  }

  beforeEach(() => {
    zoom = { createMeeting: jest.fn(), deleteMeeting: jest.fn() };
  });

  function baseSession(overrides: Partial<FakeSession> = {}): FakeSession {
    return {
      id: 's1',
      status: SessionStatus.SCHEDULED,
      meetingProvisioningStatus: MeetingProvisioningStatus.NOT_REQUIRED,
      meetingProvisioningClaimedAt: null,
      meetingProvisioningClaimToken: null,
      startTime: new Date('2026-01-01T10:00:00Z'),
      endTime: new Date('2026-01-01T11:00:00Z'),
      ...overrides,
    };
  }

  describe('provisionForSession', () => {
    it('creates a meeting and writes providerMeetingId/liveMeetingUrl/PROVISIONED', async () => {
      const { prisma } = buildFakePrisma(baseSession());
      zoom.createMeeting.mockResolvedValue({
        providerMeetingId: 'zoom-1',
        joinUrl: 'https://zoom/j/1',
      });

      await buildService(prisma).provisionForSession('s1');

      expect(zoom.createMeeting).toHaveBeenCalledTimes(1);
      const final = await prisma.session.findUnique();
      expect(final).toMatchObject({
        meetingProvider: 'ZOOM',
        providerMeetingId: 'zoom-1',
        liveMeetingUrl: 'https://zoom/j/1',
        meetingProvisioningStatus: MeetingProvisioningStatus.PROVISIONED,
      });
    });

    it('is idempotent — never calls the provider again once already PROVISIONED', async () => {
      const { prisma } = buildFakePrisma(
        baseSession({ meetingProvisioningStatus: MeetingProvisioningStatus.PROVISIONED }),
      );

      await buildService(prisma).provisionForSession('s1');

      expect(zoom.createMeeting).not.toHaveBeenCalled();
    });

    it('never provisions a CANCELED session', async () => {
      const { prisma } = buildFakePrisma(baseSession({ status: SessionStatus.CANCELED }));

      await buildService(prisma).provisionForSession('s1');

      expect(zoom.createMeeting).not.toHaveBeenCalled();
    });

    it('records FAILED with the error message and never throws when the provider call fails, and FAILED remains retryable', async () => {
      const { prisma } = buildFakePrisma(baseSession());
      zoom.createMeeting.mockRejectedValueOnce(new Error('Zoom outage'));

      const service = buildService(prisma);
      await expect(service.provisionForSession('s1')).resolves.toBeUndefined();
      expect((await prisma.session.findUnique()).meetingProvisioningStatus).toBe(
        MeetingProvisioningStatus.FAILED,
      );

      zoom.createMeeting.mockResolvedValueOnce({
        providerMeetingId: 'zoom-2',
        joinUrl: 'https://zoom/j/2',
      });
      await service.provisionForSession('s1');
      expect((await prisma.session.findUnique()).meetingProvisioningStatus).toBe(
        MeetingProvisioningStatus.PROVISIONED,
      );
    });

    it('is a no-op when the session no longer exists', async () => {
      const prisma = {
        session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUnique: jest.fn() },
      };

      await buildService(prisma).provisionForSession('missing');

      expect(zoom.createMeeting).not.toHaveBeenCalled();
    });

    it('concurrent provisioning calls cannot both create a Zoom meeting — only one claims the session (Correction 3)', async () => {
      const { prisma } = buildFakePrisma(baseSession());
      zoom.createMeeting.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ providerMeetingId: 'zoom-1', joinUrl: 'https://zoom/j/1' }),
              10,
            ),
          ),
      );

      const service = buildService(prisma);
      await Promise.all([service.provisionForSession('s1'), service.provisionForSession('s1')]);

      expect(zoom.createMeeting).toHaveBeenCalledTimes(1);
    });

    it('a stale (crashed) PENDING claim is reclaimable after the stale window', async () => {
      const { prisma, session } = buildFakePrisma(
        baseSession({
          meetingProvisioningStatus: MeetingProvisioningStatus.PENDING,
          meetingProvisioningClaimedAt: new Date(Date.now() - 5 * 60_000),
        }),
      );
      zoom.createMeeting.mockResolvedValue({
        providerMeetingId: 'zoom-1',
        joinUrl: 'https://zoom/j/1',
      });

      await buildService(prisma).provisionForSession('s1');

      expect(zoom.createMeeting).toHaveBeenCalledTimes(1);
      expect(session.meetingProvisioningStatus).toBe(MeetingProvisioningStatus.PROVISIONED);
    });

    it('a fresh (not-yet-stale) PENDING claim held by another caller is left alone', async () => {
      const { prisma } = buildFakePrisma(
        baseSession({
          meetingProvisioningStatus: MeetingProvisioningStatus.PENDING,
          meetingProvisioningClaimedAt: new Date(),
        }),
      );

      await buildService(prisma).provisionForSession('s1');

      expect(zoom.createMeeting).not.toHaveBeenCalled();
    });

    describe('fencing (Correction 3) — a stale (merely slow, not dead) provisioner cannot finalize after losing its claim', () => {
      it('deletes its own orphaned Zoom meeting instead of finalizing PROVISIONED onto a session reclaimed by someone else', async () => {
        const { prisma, session } = buildFakePrisma(baseSession());
        // Slow worker A's Zoom call is in flight; by the time it resolves,
        // simulate worker B having reclaimed the session (a different
        // claim token) by mutating the token directly, mirroring what a
        // real second `provisionForSession` call would have done via the
        // stale-window reclaim path.
        zoom.createMeeting.mockImplementation(() => {
          session.meetingProvisioningClaimToken = 'someone-elses-token';
          return Promise.resolve({ providerMeetingId: 'zoom-1', joinUrl: 'https://zoom/j/1' });
        });

        await buildService(prisma).provisionForSession('s1');

        // Never finalized onto the session — worker B's claim (and
        // whatever it eventually writes) is untouched.
        expect(session.providerMeetingId).toBeNull();
        expect(session.meetingProvisioningClaimToken).toBe('someone-elses-token');
        // The orphaned meeting worker A created is cleaned up.
        expect(zoom.deleteMeeting).toHaveBeenCalledWith('zoom-1');
      });
    });

    describe('cancellation race (Correction 3)', () => {
      it('never finalizes a live meeting onto a session that was canceled while provisioning was in flight', async () => {
        const { prisma, session } = buildFakePrisma(baseSession());
        zoom.createMeeting.mockImplementation(() => {
          // The session is canceled by another request while this Zoom
          // call is still in flight — releaseForCanceledSession finds no
          // providerMeetingId yet (this call hasn't written one), so it
          // has nothing to delete at cancellation time.
          session.status = SessionStatus.CANCELED;
          return Promise.resolve({ providerMeetingId: 'zoom-1', joinUrl: 'https://zoom/j/1' });
        });

        await buildService(prisma).provisionForSession('s1');

        expect(session.providerMeetingId).toBeNull();
        expect(session.meetingProvisioningStatus).not.toBe(MeetingProvisioningStatus.PROVISIONED);
        // The meeting created after the cancellation is best-effort
        // cleaned up rather than left dangling.
        expect(zoom.deleteMeeting).toHaveBeenCalledWith('zoom-1');
      });

      it('never finalizes FAILED onto a canceled session either', async () => {
        const { prisma, session } = buildFakePrisma(baseSession());
        zoom.createMeeting.mockImplementation(() => {
          session.status = SessionStatus.CANCELED;
          return Promise.reject(new Error('Zoom outage'));
        });

        await buildService(prisma).provisionForSession('s1');

        // Still PENDING/claimed from this caller's perspective — no
        // finalize write landed, and there was no meeting to clean up.
        expect(session.meetingProvisioningStatus).toBe(MeetingProvisioningStatus.PENDING);
        expect(zoom.deleteMeeting).not.toHaveBeenCalled();
      });
    });

    describe('post-op Correction H1 — successful Zoom creation with a failing persistence write', () => {
      it('never silently loses the providerMeetingId: a persistence failure after a successful Zoom creation deletes the orphaned meeting rather than treating it as a provider-call failure', async () => {
        const { prisma, session } = buildFakePrisma(baseSession());
        zoom.createMeeting.mockResolvedValue({
          providerMeetingId: 'zoom-1',
          joinUrl: 'https://zoom/j/1',
        });

        // The claim's own updateMany (call #1) succeeds normally via the
        // fake's real matcher; the finalize updateMany (call #2, carrying
        // the PROVISIONED data) is made to throw a genuine database error
        // instead of merely returning `{ count: 0 }` — the exact
        // distinction H1 is about.
        const originalImpl = prisma.session.updateMany.getMockImplementation()!;
        let callCount = 0;
        prisma.session.updateMany.mockImplementation((args: unknown) => {
          callCount += 1;
          if (callCount === 2) {
            return Promise.reject(new Error('connection reset'));
          }
          return originalImpl(args as never);
        });

        await buildService(prisma).provisionForSession('s1');

        // The Zoom meeting that was genuinely created is never left
        // dangling — cleanup is attempted with the real, correct id.
        expect(zoom.deleteMeeting).toHaveBeenCalledWith('zoom-1');
        // The session was never left claiming a PROVISIONED meeting it
        // never actually persisted.
        expect(session.providerMeetingId).toBeNull();
        expect(session.meetingProvisioningStatus).not.toBe(MeetingProvisioningStatus.PROVISIONED);
      });

      it('remains non-throwing and still records failure even when the cleanup deletion itself also fails', async () => {
        const { prisma, session } = buildFakePrisma(baseSession());
        zoom.createMeeting.mockResolvedValue({
          providerMeetingId: 'zoom-1',
          joinUrl: 'https://zoom/j/1',
        });
        zoom.deleteMeeting.mockRejectedValue(new Error('Zoom outage'));

        const originalImpl = prisma.session.updateMany.getMockImplementation()!;
        let callCount = 0;
        prisma.session.updateMany.mockImplementation((args: unknown) => {
          callCount += 1;
          if (callCount === 2) {
            return Promise.reject(new Error('connection reset'));
          }
          return originalImpl(args as never);
        });

        // Never throws — provisionForSession's non-throwing contract
        // holds even when both the persistence write AND the cleanup
        // attempt fail.
        await expect(buildService(prisma).provisionForSession('s1')).resolves.toBeUndefined();

        // The failure is not swallowed into silence — a best-effort
        // final write records FAILED (using the third updateMany call,
        // which succeeds against the fake's real matcher).
        expect(session.meetingProvisioningStatus).toBe(MeetingProvisioningStatus.FAILED);
        expect(session.meetingProvisioningError).toContain('could not be auto-deleted');
      });
    });
  });

  describe('releaseForCanceledSession', () => {
    it('deletes the provider meeting when one exists', async () => {
      const { prisma } = buildFakePrisma(
        baseSession({ status: SessionStatus.CANCELED, providerMeetingId: 'zoom-1' }),
      );

      await buildService(prisma).releaseForCanceledSession('s1');

      expect(zoom.deleteMeeting).toHaveBeenCalledWith('zoom-1');
    });

    it('is a no-op when the session never had a provider meeting', async () => {
      const { prisma } = buildFakePrisma(baseSession({ status: SessionStatus.CANCELED }));

      await buildService(prisma).releaseForCanceledSession('s1');

      expect(zoom.deleteMeeting).not.toHaveBeenCalled();
    });

    it('never throws when the provider deletion fails', async () => {
      const { prisma } = buildFakePrisma(
        baseSession({ status: SessionStatus.CANCELED, providerMeetingId: 'zoom-1' }),
      );
      zoom.deleteMeeting.mockRejectedValue(new Error('Zoom outage'));

      await expect(buildService(prisma).releaseForCanceledSession('s1')).resolves.toBeUndefined();
    });
  });
});
