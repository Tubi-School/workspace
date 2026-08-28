import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import {
  NotificationStatus,
  type NotificationOutboxItem,
  type Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailProviderService } from './email-provider.service.js';
import {
  renderNotification,
  type NotificationPayload,
  type NotificationType,
} from './notification-templates.js';

/** A permanently-failed item stops retrying rather than looping forever
 * against a durably broken configuration or address. */
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;

/**
 * A SENDING claim older than this is treated as abandoned (the instance
 * that took it crashed, was killed mid-send, or its email round trip
 * merely took longer than this) and may be reclaimed by the next tick, on
 * this or another Railway instance.
 *
 * Fencing (Phase 4 external review Correction 4): the stale window alone
 * cannot tell "the original dispatcher died" apart from "SMTP is just
 * slow" — if the original send eventually completes after another
 * instance has reclaimed the item, its final SENT/PENDING/FAILED write
 * must not clobber the reclaiming instance's outcome. Every claim carries
 * a fresh random `claimToken`; the final write is conditional on that
 * token still matching. A dispatcher that lost its claim silently no-ops
 * on its write instead of overwriting the newer claim's state.
 *
 * Unavoidable, honestly-disclosed boundary this does NOT close: if SMTP
 * accepts the message and the process then dies before the SENT write
 * commits, the item reverts to retryable (PENDING, via the stale-window
 * reclaim) and a retry sends the email again. TUBI's outbox has no way to
 * ask an SMTP provider "did you actually already send this" — plain SMTP
 * offers no delivery idempotency key. This design is at-least-once
 * delivery with duplicate minimization (the fencing above prevents the
 * far more common "two live instances both send it" case), not
 * mathematically duplicate-free delivery. No stronger guarantee is made
 * anywhere in this codebase or its documentation.
 */
const STALE_SENDING_WINDOW_MS = 60_000;

/**
 * The durable retry loop behind the notification outbox (section N/O). A
 * simple DB-backed poll, not a message broker — this school does not need
 * one.
 */
@Injectable()
export class NotificationDispatchScheduler {
  private readonly logger = new Logger(NotificationDispatchScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailProvider: EmailProviderService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchPending(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_SENDING_WINDOW_MS);

    const candidates = await this.prisma.notificationOutboxItem.findMany({
      where: {
        OR: [
          { status: NotificationStatus.PENDING },
          { status: NotificationStatus.SENDING, claimedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const item of candidates) {
      const token = randomUUID();
      const claim = await this.prisma.notificationOutboxItem.updateMany({
        where: {
          id: item.id,
          OR: [
            { status: NotificationStatus.PENDING },
            { status: NotificationStatus.SENDING, claimedAt: { lt: staleBefore } },
          ],
        },
        data: { status: NotificationStatus.SENDING, claimedAt: new Date(), claimToken: token },
      });

      if (claim.count === 0) {
        continue; // Another instance's identical claim already won this item.
      }

      await this.dispatchOne(item, token);
    }
  }

  private async dispatchOne(item: NotificationOutboxItem, token: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: item.recipientUserId } });

      if (!user) {
        await this.markPermanentlyFailed(
          item.id,
          token,
          `Recipient user ${item.recipientUserId} not found`,
        );
        return;
      }

      const { subject, text } = renderNotification(
        item.type as NotificationType,
        item.payload as NotificationPayload,
      );
      await this.emailProvider.send(user.email, subject, text);

      await this.finalize(item.id, token, {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        claimedAt: null,
        claimToken: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown notification dispatch error';
      const attempts = item.attempts + 1;

      if (attempts >= MAX_ATTEMPTS) {
        await this.markPermanentlyFailed(item.id, token, message, attempts);
        this.logger.error(
          `Notification ${item.id} permanently failed after ${attempts} attempts: ${message}`,
        );
        return;
      }

      // Back to PENDING (not left SENDING) so the very next tick can
      // retry immediately rather than waiting out the stale window.
      await this.finalize(item.id, token, {
        status: NotificationStatus.PENDING,
        attempts,
        lastError: message,
        claimedAt: null,
        claimToken: null,
      });
    }
  }

  private async markPermanentlyFailed(
    id: string,
    token: string,
    lastError: string,
    attempts?: number,
  ): Promise<void> {
    await this.finalize(id, token, {
      status: NotificationStatus.FAILED,
      lastError,
      claimedAt: null,
      claimToken: null,
      ...(attempts !== undefined ? { attempts } : {}),
    });
  }

  /** Writes a terminal (or retry-ready) outcome only if `token` still
   * matches this item's current claim — fenced (Correction 4) so a
   * dispatcher whose lease was reclaimed by another instance after the
   * stale window can never overwrite that instance's outcome. */
  private async finalize(
    id: string,
    token: string,
    data: Prisma.NotificationOutboxItemUpdateManyMutationInput,
  ): Promise<void> {
    const result = await this.prisma.notificationOutboxItem.updateMany({
      where: { id, claimToken: token, status: NotificationStatus.SENDING },
      data,
    });

    if (result.count === 0) {
      this.logger.warn(
        `Notification ${id}'s dispatch outcome was discarded — another instance had already reclaimed its stale claim.`,
      );
    }
  }
}
