import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import type { AppConfig } from '../config/environment.js';
import { SessionStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Generates upcoming-class reminders (section N). Runs every minute and
 * looks ahead by a configurable window (SESSION_REMINDER_LOOKAHEAD_MINUTES,
 * default 60).
 *
 * Phase 4 external review Correction 4A: claiming `reminderSentAt` and
 * creating the NotificationOutboxItem rows for that session are one
 * Postgres transaction — either both commit or neither does. The failure
 * mode the review identified (a crash between claiming and enqueueing,
 * permanently losing the reminder because `reminderSentAt` is already
 * non-null) is no longer reachable: if the transaction never commits, the
 * claim itself never happened either, and the next tick sees
 * `reminderSentAt: null` again and tries afresh.
 */
@Injectable()
export class SessionReminderScheduler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueReminders(): Promise<void> {
    const lookaheadMinutes = this.config.get('SESSION_REMINDER_LOOKAHEAD_MINUTES', { infer: true });
    const now = new Date();
    const windowEnd = new Date(now.getTime() + lookaheadMinutes * 60_000);

    const dueSessions = await this.prisma.session.findMany({
      where: {
        status: SessionStatus.SCHEDULED,
        startTime: { gte: now, lte: windowEnd },
        reminderSentAt: null,
      },
      include: { course: true },
    });

    for (const session of dueSessions) {
      await this.prisma.$transaction(async (tx) => {
        // Conditional update inside the transaction: a session already
        // claimed by another tick/instance between the read above and
        // here matches zero rows, and this transaction commits as a
        // total no-op.
        const claim = await tx.session.updateMany({
          where: { id: session.id, reminderSentAt: null },
          data: { reminderSentAt: now },
        });

        if (claim.count === 0) {
          return; // Another tick/instance already claimed this session.
        }

        const payload = {
          courseTitle: session.course.title,
          startTime: session.startTime.toISOString(),
        };
        await this.notifications.enqueueForEntitledLearners(
          session.id,
          'SESSION_REMINDER',
          payload,
          tx,
        );
        await this.notifications.enqueueForAssignedTeachers(
          session.id,
          'SESSION_REMINDER',
          payload,
          tx,
        );
      });
    }
  }
}
