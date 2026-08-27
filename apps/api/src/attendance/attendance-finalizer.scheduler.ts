import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AttendanceService } from './attendance.service.js';

/**
 * Production scheduling for AttendanceService.finalizeDueRecords (Phase
 * 2G, "Automated Attendance Finalization").
 *
 * Phase 2F built finalizeDueRecords as an idempotent, admin-triggerable
 * operation; nothing called it automatically. This runs it on a fixed
 * interval so PENDING -> ABSENT finalization no longer depends on an
 * administrator pressing a button.
 *
 * Interval: every 5 minutes (`CronExpression.EVERY_5_MINUTES`). Chosen
 * because the normal cutoff granularity is a fixed clock time (23:59
 * Africa/Johannesburg, or an explicit AttendanceWindowException
 * timestamp) with no sub-minute precision requirement anywhere in the
 * frozen domain design — a learner is never meaningfully harmed by being
 * finalized ABSENT up to ~5 minutes after their exact cutoff instant, and
 * 5 minutes keeps the number of no-op runs (almost every tick, since most
 * PENDING records are not yet due) small without meaningfully delaying
 * finalization. This does not change any founder-defined semantics — the
 * cutoff moment itself is untouched; only how promptly the system notices
 * it has passed.
 *
 * Safety under multiple replicas: finalizeDueRecords is idempotent by
 * construction (every write is an `updateMany` guarded by
 * `status: PENDING` in the WHERE clause — see attendance.service.ts). If
 * two replicas' schedulers fire in the same window, the second one's
 * `updateMany` calls simply match zero rows for anything the first
 * already finalized. No distributed lock is needed for correctness, only
 * for avoiding duplicate log lines, which is not worth the complexity
 * this milestone explicitly asks not to introduce.
 */
@Injectable()
export class AttendanceFinalizerScheduler {
  private readonly logger = new Logger(AttendanceFinalizerScheduler.name);

  constructor(private readonly attendanceService: AttendanceService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'attendance-finalizer' })
  async run(): Promise<void> {
    const { finalizedCount } = await this.attendanceService.finalizeDueRecords();

    if (finalizedCount > 0) {
      this.logger.log(`Finalized ${finalizedCount} PENDING attendance record(s) to ABSENT`);
    }
  }
}
