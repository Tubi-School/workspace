import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { Prisma, WebhookEventStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/**
 * A PROCESSING claim older than this is treated as abandoned (the process
 * that took it crashed before finishing) and may be reclaimed by the next
 * delivery/retry. This is the honest, bounded crash-recovery window this
 * design offers: a genuine crash mid-processing leaves the event
 * effectively stuck — appearing "handled" to a retry that arrives within
 * this window — until it elapses, at which point the provider's own retry
 * (both Zoom and Paystack retry failed/unacknowledged webhooks over a much
 * longer horizon than this) reclaims and completes it. This is not
 * "exactly once" in the distributed-systems sense — it is "at least once,
 * with a bounded window where a mid-crash delivery is temporarily
 * unresolved" — which is what a single Postgres database can actually
 * guarantee without a message broker.
 *
 * Fencing (Phase 4 external review Correction 2): the stale window alone
 * does not distinguish "the original worker is dead" from "the original
 * worker is simply still running past the window" — a slow-but-alive
 * worker A could have its claim reclaimed by worker B, and without
 * fencing, worker A's eventual (stale) `markProcessed`/`markFailed` call
 * could clobber worker B's active or already-completed claim. Every claim
 * carries a fresh random `claimToken`; `markProcessed`/`markFailed` only
 * take effect when the caller's token still matches the row's current
 * token. A worker that lost its claim silently no-ops instead of
 * corrupting the newer claim's state — this does not prevent the honestly-
 * disclosed stale-reclaim window above, it only prevents a stale worker
 * from ever acting as if it still owned the claim.
 */
const STALE_PROCESSING_WINDOW_MS = 120_000;

export type WebhookClaimOutcome =
  | { outcome: 'PROCEED'; token: string }
  | { outcome: 'ALREADY_PROCESSED' }
  | { outcome: 'CLAIMED_BY_OTHER' };

/**
 * Webhook idempotency ledger shared by every provider this school
 * integrates with (Zoom, and the payments module) — section I / Phase 4
 * external review Corrections 1 and 2.
 */
@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Call once per inbound delivery, before any business processing.
   *
   * - `ALREADY_PROCESSED`: the event was already successfully applied —
   *   the caller must skip processing and respond success.
   * - `CLAIMED_BY_OTHER`: another delivery is currently (within the stale
   *   window) applying this same event — the caller must skip processing
   *   and respond success; the business effect will be applied exactly
   *   once by whichever delivery actually holds the claim.
   * - `PROCEED`: this caller now holds the claim (identified by `token`)
   *   and must run business processing, then call `markProcessed` or
   *   `markFailed` with that same token.
   */
  async claim(
    provider: string,
    externalEventId: string,
    eventType: string,
  ): Promise<WebhookClaimOutcome> {
    try {
      await this.prisma.providerWebhookEvent.create({
        data: { provider, externalEventId, eventType, status: WebhookEventStatus.RECEIVED },
      });
    } catch (error) {
      if (!this.isUniqueConstraintViolation(error)) {
        throw error;
      }
      // Row already exists — fall through to inspect its current state.
    }

    const existing = await this.prisma.providerWebhookEvent.findUnique({
      where: { provider_externalEventId: { provider, externalEventId } },
    });

    if (existing?.status === WebhookEventStatus.PROCESSED) {
      return { outcome: 'ALREADY_PROCESSED' };
    }

    const staleBefore = new Date(Date.now() - STALE_PROCESSING_WINDOW_MS);
    const token = randomUUID();

    // Atomic compare-and-swap: only one concurrent caller's UPDATE matches
    // a still-RECEIVED (or abandoned-stale-PROCESSING) row and actually
    // flips it to PROCESSING — every other simultaneous caller's identical
    // UPDATE matches zero rows and gets told to stand down. The fresh
    // token written here is this caller's proof of ownership.
    const claimed = await this.prisma.providerWebhookEvent.updateMany({
      where: {
        provider,
        externalEventId,
        OR: [
          { status: WebhookEventStatus.RECEIVED },
          { status: WebhookEventStatus.PROCESSING, claimedAt: { lt: staleBefore } },
        ],
      },
      data: { status: WebhookEventStatus.PROCESSING, claimedAt: new Date(), claimToken: token },
    });

    return claimed.count > 0 ? { outcome: 'PROCEED', token } : { outcome: 'CLAIMED_BY_OTHER' };
  }

  /** No-ops (logged) if `token` no longer matches — this caller's claim
   * was reclaimed by another worker and it must never overwrite that
   * worker's state. */
  async markProcessed(provider: string, externalEventId: string, token: string): Promise<void> {
    const result = await this.prisma.providerWebhookEvent.updateMany({
      where: {
        provider,
        externalEventId,
        claimToken: token,
        status: WebhookEventStatus.PROCESSING,
      },
      data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date() },
    });

    if (result.count === 0) {
      this.logger.warn(
        `markProcessed for ${provider}:${externalEventId} found no matching claim — this worker's claim was reclaimed by another worker; ignoring to avoid overwriting its state.`,
      );
    }
  }

  /** Puts the event back to RECEIVED so the very next delivery/retry can
   * reclaim it immediately — a failed first attempt never permanently
   * poisons the event, and never has to wait out the stale window.
   * No-ops (logged) if `token` no longer matches, for the same fencing
   * reason as `markProcessed`. */
  async markFailed(provider: string, externalEventId: string, token: string): Promise<void> {
    const result = await this.prisma.providerWebhookEvent.updateMany({
      where: {
        provider,
        externalEventId,
        claimToken: token,
        status: WebhookEventStatus.PROCESSING,
      },
      data: { status: WebhookEventStatus.RECEIVED, claimedAt: null, claimToken: null },
    });

    if (result.count === 0) {
      this.logger.warn(
        `markFailed for ${provider}:${externalEventId} found no matching claim — this worker's claim was reclaimed by another worker; ignoring to avoid reverting its state.`,
      );
    }
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
    );
  }
}
