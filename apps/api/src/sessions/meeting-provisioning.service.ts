import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { MeetingProvisioningStatus, SessionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZoomProviderService } from '../providers/zoom/zoom-provider.service.js';

const ZOOM_PROVIDER_NAME = 'ZOOM';

/**
 * A PENDING claim older than this is treated as abandoned (the caller that
 * took it crashed before Zoom responded) and may be reclaimed by the next
 * provisioning attempt (automatic on session creation, or ADMIN's manual
 * retry). Zoom's own meeting-creation API responds in well under a second
 * in the ordinary case; this window is deliberately generous relative to
 * that.
 *
 * Fencing (Phase 4 external review Correction 3): the stale window alone
 * cannot distinguish "the original caller crashed" from "the original
 * caller is simply still waiting on a slow Zoom response" — without
 * fencing, a second caller reclaiming after the window elapses could
 * create a second Zoom meeting while the first caller's (merely slow, not
 * dead) Zoom request is still in flight, and whichever caller finishes
 * last would silently overwrite the other's result. Every claim carries a
 * fresh random `meetingProvisioningClaimToken`; persisting a final
 * PROVISIONED/FAILED result is itself conditional on that token still
 * matching (and the session not having been canceled in the meantime —
 * see the cancellation-race handling below). A caller that lost its claim
 * never finalizes a meeting onto the session — at worst it has created an
 * orphaned Zoom meeting, which it then best-effort deletes.
 *
 * This does NOT claim exactly-once Zoom meeting creation: if a caller's
 * Zoom request is genuinely still in flight when another caller reclaims
 * and also calls Zoom, both may successfully create a meeting with Zoom
 * (Zoom's API offers no cross-caller reservation/two-phase-commit
 * primitive). Fencing guarantees only that at most one of those two
 * outcomes is ever persisted onto the Session — the loser's orphaned
 * meeting is cleaned up best-effort, not left silently attached anywhere.
 * See the doc comment on `finalize` below for the precise cleanup
 * behavior and its own honest limit.
 */
const PROVISIONING_STALE_WINDOW_MS = 120_000;

@Injectable()
export class MeetingProvisioningService {
  private readonly logger = new Logger(MeetingProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zoom: ZoomProviderService,
  ) {}

  /** Best-effort — never throws. A Zoom outage must not prevent a Session
   * from being created; ADMIN can retry provisioning explicitly once the
   * provider recovers (see `POST /admin/sessions/:id/provision-meeting`). */
  async provisionForSession(sessionId: string): Promise<void> {
    const staleBefore = new Date(Date.now() - PROVISIONING_STALE_WINDOW_MS);
    const token = randomUUID();

    // Atomic claim: this UPDATE only matches (and thus only succeeds for)
    // a session that is NOT_REQUIRED/FAILED, or a PENDING session whose
    // claim has gone stale. A session already PROVISIONED, CANCELED, or
    // genuinely mid-provisioning-by-someone-else matches nothing, and
    // this caller returns without ever touching Zoom.
    const claim = await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        status: { not: SessionStatus.CANCELED },
        OR: [
          {
            meetingProvisioningStatus: {
              in: [MeetingProvisioningStatus.NOT_REQUIRED, MeetingProvisioningStatus.FAILED],
            },
          },
          {
            meetingProvisioningStatus: MeetingProvisioningStatus.PENDING,
            meetingProvisioningClaimedAt: { lt: staleBefore },
          },
        ],
      },
      data: {
        meetingProvisioningStatus: MeetingProvisioningStatus.PENDING,
        meetingProvisioningClaimedAt: new Date(),
        meetingProvisioningClaimToken: token,
      },
    });

    if (claim.count === 0) {
      return; // Already PROVISIONED, CANCELED, or another caller has an active claim.
    }

    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      return;
    }

    // Phase 4 external review post-op Correction H1: provider-call failure
    // and post-provider persistence failure are deliberately two separate
    // try/catch blocks, not one. Collapsing them into a single catch was
    // the actual defect — a successful `zoom.createMeeting` followed by a
    // *persistence* failure (a real database error thrown out of
    // `finalize`, not merely its own internal "lost the claim" no-op) was
    // being handled identically to "the provider call itself failed,"
    // which discarded `meeting.providerMeetingId` entirely and marked the
    // session FAILED (silently retryable) — the next retry would then
    // create a second, genuinely new Zoom meeting while the first sat
    // orphaned and completely untracked by TUBI.
    let meeting: { providerMeetingId: string; joinUrl: string };
    try {
      const durationMinutes = Math.max(
        1,
        Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60_000),
      );

      meeting = await this.zoom.createMeeting({
        topic: `TUBI Session ${session.id}`,
        startTime: session.startTime,
        durationMinutes,
      });
    } catch (error) {
      // The provider call itself failed — no external meeting was ever
      // created, so there is nothing to track or clean up.
      const message = error instanceof Error ? error.message : 'Unknown provisioning error';
      this.logger.error(`Meeting provisioning failed for session ${sessionId}: ${message}`);
      await this.markFailed(sessionId, token, message);
      return;
    }

    // Zoom has now genuinely created a meeting. From this point on, ANY
    // failure is a persistence failure, never a "provider call failed"
    // outcome — `meeting.providerMeetingId` must never be silently lost.
    try {
      await this.finalize(
        sessionId,
        token,
        {
          meetingProvider: ZOOM_PROVIDER_NAME,
          providerMeetingId: meeting.providerMeetingId,
          liveMeetingUrl: meeting.joinUrl,
          meetingProvisioningStatus: MeetingProvisioningStatus.PROVISIONED,
          meetingProvisioningError: null,
        },
        meeting.providerMeetingId,
      );
    } catch (error) {
      // `finalize`'s own internal "lost the claim/session canceled" path
      // (count === 0) does not throw — it already performs the orphan
      // cleanup and returns normally. Reaching this catch means the
      // database write itself failed (e.g. a connection error), which is
      // a fundamentally different situation: a real Zoom meeting exists,
      // uncommitted anywhere in TUBI. The smallest robust response is to
      // delete that meeting (so a subsequent retry cannot create a
      // duplicate for no reason) and best-effort record FAILED with a
      // message that names the orphaned meeting id for manual
      // reconciliation if the cleanup itself also fails. Every step here
      // is independently best-effort — this method's own non-throwing
      // contract must hold even if the database is genuinely down.
      const message = error instanceof Error ? error.message : 'Unknown persistence error';
      this.logger.error(
        `Zoom meeting ${meeting.providerMeetingId} was created for session ${sessionId} but persisting it failed: ${message}. Attempting to delete the meeting to avoid a duplicate on retry.`,
      );

      let cleanupNote = '';
      try {
        await this.zoom.deleteMeeting(meeting.providerMeetingId);
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error';
        this.logger.error(
          `Failed to delete orphaned Zoom meeting ${meeting.providerMeetingId} for session ${sessionId} after a persistence failure: ${cleanupMessage}. This meeting may need manual reconciliation in Zoom.`,
        );
        cleanupNote = ` (orphaned Zoom meeting ${meeting.providerMeetingId} could not be auto-deleted: ${cleanupMessage})`;
      }

      await this.markFailed(sessionId, token, `${message}${cleanupNote}`);
    }
  }

  /** Marks the claim FAILED with a readable error, swallowing (logging)
   * its own failure rather than throwing — `provisionForSession` must
   * remain non-throwing even when this final best-effort write itself
   * cannot be persisted. */
  private async markFailed(sessionId: string, token: string, message: string): Promise<void> {
    try {
      await this.finalize(sessionId, token, {
        meetingProvisioningStatus: MeetingProvisioningStatus.FAILED,
        meetingProvisioningError: message,
      });
    } catch (error) {
      const finalizeMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to record FAILED provisioning status for session ${sessionId}: ${finalizeMessage}`,
      );
    }
  }

  /**
   * Persists a provisioning outcome only if this caller still owns the
   * claim (`meetingProvisioningClaimToken` still matches) AND the session
   * has not been canceled in the meantime — both checked in the same
   * atomic conditional UPDATE. If either has changed, this caller lost
   * the race: its result (success or failure) must never be written onto
   * a session another caller is now responsible for, or that has since
   * been canceled.
   *
   * Cancellation race this closes: if provisioning is in flight when
   * `SessionsService.cancel` runs, `releaseForCanceledSession` finds no
   * `providerMeetingId` yet (provisioning hasn't finished) and has
   * nothing to delete. Without this check, the in-flight provisioner
   * would later write a live `providerMeetingId`/PROVISIONED onto the
   * now-canceled session. With it, the UPDATE below matches zero rows
   * (the session's `status` is no longer `not: CANCELED`), and — if a
   * Zoom meeting was in fact just created — it is deleted here instead.
   *
   * This is best-effort cleanup, not a guarantee: if the Zoom deletion
   * call itself fails (network error, Zoom outage), an orphaned Zoom
   * meeting can remain on Zoom's side with no TUBI Session pointing at
   * it. That orphan is inert (nothing in TUBI ever reads
   * `providerMeetingId` from anywhere but this Session row, and this
   * Session is CANCELED or owned by another claim) — it is a Zoom-side
   * cleanup gap, not a TUBI data-integrity or security issue.
   *
   * Note: this method itself may throw (a genuine database failure on
   * the conditional UPDATE) — it is NOT internally best-effort against
   * that case. Callers that have just created a real Zoom meeting
   * (`provisionForSession`'s success path) must catch that specifically
   * and treat it as a persistence failure, never as "the provider call
   * failed" — see the post-op Correction H1 handling above.
   */
  private async finalize(
    sessionId: string,
    token: string,
    data: {
      meetingProvider?: string;
      providerMeetingId?: string;
      liveMeetingUrl?: string;
      meetingProvisioningStatus: MeetingProvisioningStatus;
      meetingProvisioningError: string | null;
    },
    createdProviderMeetingId?: string,
  ): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        meetingProvisioningClaimToken: token,
        status: { not: SessionStatus.CANCELED },
      },
      data,
    });

    if (result.count === 0 && createdProviderMeetingId) {
      this.logger.warn(
        `Session ${sessionId} lost its provisioning claim or was canceled before the Zoom meeting could be finalized — deleting the orphaned meeting ${createdProviderMeetingId}.`,
      );
      try {
        await this.zoom.deleteMeeting(createdProviderMeetingId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Failed to delete orphaned Zoom meeting ${createdProviderMeetingId} for session ${sessionId}: ${message}`,
        );
      }
    }
  }

  /** Best-effort deletion of the provider meeting when a Session is
   * canceled. Failures are logged, never surfaced — cancellation is
   * authoritative in TUBI regardless of whether Zoom cleanup succeeds. */
  async releaseForCanceledSession(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    if (!session?.providerMeetingId) {
      return;
    }

    try {
      await this.zoom.deleteMeeting(session.providerMeetingId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to release Zoom meeting for canceled session ${sessionId}: ${message}`,
      );
    }
  }
}
