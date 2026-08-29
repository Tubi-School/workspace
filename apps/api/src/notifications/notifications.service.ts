import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { NotificationStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { NotificationPayload, NotificationType } from './notification-templates.js';

/** The ADMIN-facing shape returned by `listAll` — deliberately NOT the raw
 * `NotificationOutboxItem` row. `claimToken` and `claimedAt` are internal
 * dispatcher-fencing state (see `notification-dispatch.scheduler.ts`) with
 * no operational meaning to an ADMIN, and `payload` may contain more than
 * an ADMIN needs to see; none of the three are sent to the browser. */
export interface NotificationOutboxItemWithRecipient {
  id: string;
  type: string;
  recipientUserId: string;
  status: NotificationStatus;
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
  lastError: string | null;
  recipient: { id: string; email: string; fullName: string } | null;
}

/** Either the ordinary client or a caller-supplied transaction client —
 * every method here accepts one (defaulting to `this.prisma`) so a caller
 * like `SessionReminderScheduler` can enqueue notifications atomically
 * alongside its own write, rather than risking a crash between the two
 * (Phase 4 external review Correction 4A). */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * The single seam every school-domain service enqueues a notification
 * through (section N/O). `enqueue` only ever writes one durable outbox
 * row and returns — it never sends anything itself and never throws for
 * a reason unrelated to the write itself, so a notification failure can
 * never roll back the payment/entitlement/session/attendance operation
 * that triggered it. Actual delivery, retries, and permanent-failure
 * handling belong to NotificationDispatchScheduler.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(
    type: NotificationType,
    recipientUserId: string,
    payload: NotificationPayload,
    db: Db = this.prisma,
  ): Promise<void> {
    await db.notificationOutboxItem.create({
      data: {
        type,
        recipientUserId,
        payload,
        status: NotificationStatus.PENDING,
      },
    });
  }

  /** Enqueues one notification per learner historically entitled to the
   * session — the same SessionEntitlementSnapshot rows every other
   * learner-facing read already relies on, so a notification is only ever
   * sent to someone who genuinely had access to the class. */
  async enqueueForEntitledLearners(
    sessionId: string,
    type: NotificationType,
    payload: NotificationPayload,
    db: Db = this.prisma,
  ): Promise<void> {
    const snapshots = await db.sessionEntitlementSnapshot.findMany({
      where: { sessionId, wasEntitled: true },
      select: { learner: { select: { user: { select: { id: true } } } } },
    });

    await Promise.all(
      snapshots.map((snapshot) => this.enqueue(type, snapshot.learner.user.id, payload, db)),
    );
  }

  async enqueueForAssignedTeachers(
    sessionId: string,
    type: NotificationType,
    payload: NotificationPayload,
    db: Db = this.prisma,
  ): Promise<void> {
    const assignments = await db.sessionTeacher.findMany({
      where: { sessionId },
      select: { teacher: { select: { user: { select: { id: true } } } } },
    });

    await Promise.all(
      assignments.map((assignment) => this.enqueue(type, assignment.teacher.user.id, payload, db)),
    );
  }

  /** ADMIN visibility into the outbox (Phase 5 section 15). Read-only —
   * never mutates dispatch state. `recipientUserId` is a plain column (no
   * FK relation on this table), so the recipient is joined manually here
   * rather than via a Prisma `include`. */
  async listAll(status?: NotificationStatus): Promise<NotificationOutboxItemWithRecipient[]> {
    const items = await this.prisma.notificationOutboxItem.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        type: true,
        recipientUserId: true,
        status: true,
        attempts: true,
        createdAt: true,
        sentAt: true,
        lastError: true,
        // Deliberately NOT selected: claimToken, claimedAt (internal
        // dispatcher fencing state), payload (may contain more than an
        // ADMIN needs to see).
      },
    });

    const userIds = [...new Set(items.map((item) => item.recipientUserId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, fullName: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));

    return items.map((item) => ({
      ...item,
      recipient: userById.get(item.recipientUserId) ?? null,
    }));
  }

  /** Resets one permanently-failed item back to PENDING so the existing
   * fenced NotificationDispatchScheduler can safely reclaim it on its next
   * tick. Only ever operates on FAILED rows — never reaches into
   * PENDING/SENDING/SENT state, so this can never race the dispatcher's own
   * claim-token fencing or double-send a message already in flight. */
  async retryFailed(id: string): Promise<NotificationOutboxItemWithRecipient> {
    const item = await this.prisma.notificationOutboxItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    if (item.status !== NotificationStatus.FAILED) {
      throw new ConflictException(
        `Notification ${id} is ${item.status}, not FAILED — only permanently-failed notifications can be retried`,
      );
    }

    const { count } = await this.prisma.notificationOutboxItem.updateMany({
      where: { id, status: NotificationStatus.FAILED },
      data: {
        status: NotificationStatus.PENDING,
        claimToken: null,
        claimedAt: null,
        attempts: 0,
        lastError: null,
      },
    });
    if (count === 0) {
      throw new ConflictException(
        `Notification ${id} is no longer FAILED — it may already be retrying`,
      );
    }

    const [refreshed] = await this.listAllByIds([id]);
    if (!refreshed) {
      throw new NotFoundException(`Notification ${id} not found after retry`);
    }
    return refreshed;
  }

  /** Shared minimized projection for a known set of IDs — used by
   * `retryFailed` so its response goes through the same field-minimization
   * as `listAll` rather than returning the raw row a second time. */
  private async listAllByIds(ids: string[]): Promise<NotificationOutboxItemWithRecipient[]> {
    const items = await this.prisma.notificationOutboxItem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        type: true,
        recipientUserId: true,
        status: true,
        attempts: true,
        createdAt: true,
        sentAt: true,
        lastError: true,
      },
    });

    const userIds = [...new Set(items.map((item) => item.recipientUserId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, fullName: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));

    return items.map((item) => ({
      ...item,
      recipient: userById.get(item.recipientUserId) ?? null,
    }));
  }
}
