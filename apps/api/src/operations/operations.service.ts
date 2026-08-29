import { Injectable } from '@nestjs/common';
import {
  MeetingProvisioningStatus,
  NotificationStatus,
  PaymentStatus,
  SessionStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailProviderService } from '../notifications/email-provider.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { ZoomProviderService } from '../providers/zoom/zoom-provider.service.js';

export interface ProviderConfigurationStatus {
  zoom: 'CONFIGURED' | 'NOT_CONFIGURED';
  payments: 'CONFIGURED' | 'NOT_CONFIGURED';
  email: 'CONFIGURED' | 'NOT_CONFIGURED';
}

/** `null` means "not queryable right now" (the database is down), never a
 * misleading `0`. An ADMIN reading `0` must be able to trust that it means
 * zero, not "the query never ran." */
export type OperationalCount = number | null;

export interface LaunchOperationsReport {
  database: 'ok' | 'down';
  providers: ProviderConfigurationStatus;
  stuckMeetingsCount: OperationalCount;
  permanentlyFailedNotificationsCount: OperationalCount;
  paymentsAwaitingResolutionCount: OperationalCount;
  upcomingSessionsCount: OperationalCount;
}

/**
 * The single ADMIN-facing question this answers (Phase 5 section 17): is
 * the school operable right now? Deliberately not a generic observability
 * platform — a fixed, small set of operational counts and configuration
 * booleans, never raw provider credential values.
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zoomProvider: ZoomProviderService,
    private readonly paymentsService: PaymentsService,
    private readonly emailProvider: EmailProviderService,
  ) {}

  /** The database is probed FIRST, and the four operational counts are
   * only ever queried when that probe succeeds. If the database is down,
   * every count is reported as `null` ("unavailable") rather than
   * attempting the count queries anyway — a report generated while
   * PostgreSQL is unreachable must never show a `0` an ADMIN could
   * mistake for "nothing is stuck," when the true answer is "unknown." */
  async getReport(): Promise<LaunchOperationsReport> {
    const database = await this.probeDatabase();

    if (database === 'down') {
      return {
        database,
        providers: this.getProviderConfiguration(),
        stuckMeetingsCount: null,
        permanentlyFailedNotificationsCount: null,
        paymentsAwaitingResolutionCount: null,
        upcomingSessionsCount: null,
      };
    }

    const [
      stuckMeetingsCount,
      permanentlyFailedNotificationsCount,
      paymentsAwaitingResolutionCount,
      upcomingSessionsCount,
    ] = await Promise.all([
      this.prisma.session.count({
        where: { meetingProvisioningStatus: MeetingProvisioningStatus.FAILED },
      }),
      this.prisma.notificationOutboxItem.count({
        where: { status: NotificationStatus.FAILED },
      }),
      this.prisma.paymentOrder.count({ where: { status: PaymentStatus.PENDING } }),
      this.prisma.session.count({
        where: { status: SessionStatus.SCHEDULED, startTime: { gte: new Date() } },
      }),
    ]);

    return {
      database,
      providers: this.getProviderConfiguration(),
      stuckMeetingsCount,
      permanentlyFailedNotificationsCount,
      paymentsAwaitingResolutionCount,
      upcomingSessionsCount,
    };
  }

  private getProviderConfiguration(): ProviderConfigurationStatus {
    return {
      zoom: this.zoomProvider.isOperationallyConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
      payments: this.paymentsService.isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
      email: this.emailProvider.isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
    };
  }

  private async probeDatabase(): Promise<'ok' | 'down'> {
    try {
      await this.prisma.ping();
      return 'ok';
    } catch {
      return 'down';
    }
  }
}
