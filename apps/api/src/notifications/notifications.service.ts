import { Injectable } from '@nestjs/common';

import { NotificationStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { NotificationPayload, NotificationType } from './notification-templates.js';

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
}
