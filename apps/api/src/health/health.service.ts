import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment, DependencyHealth, HealthReport, HealthStatus } from '@tubi/types';
import { assertNever } from '@tubi/utils';

import { PrismaService } from '../prisma/prisma.service.js';

/** The only string a failed database probe may return to an HTTP caller.
 * Deliberately generic — see probeDatabase for why. */
const GENERIC_DATABASE_ERROR = 'Database unavailable';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Liveness: is this process running and able to answer?
   *
   * Deliberately checks nothing external. A liveness probe that fails because
   * the database is briefly unreachable causes the orchestrator to restart a
   * perfectly healthy container, which makes the outage worse.
   */
  getLiveness(): HealthReport {
    return this.buildReport('ok', []);
  }

  /**
   * Readiness: should this instance receive traffic?
   *
   * This one does check dependencies, because an instance that cannot reach
   * PostgreSQL cannot serve a useful response.
   */
  async getReadiness(): Promise<HealthReport> {
    const database = await this.probeDatabase();
    const status: HealthStatus = database.status === 'ok' ? 'ok' : 'degraded';

    return this.buildReport(status, [database]);
  }

  /**
   * Whether an instance reporting `status` should be sent traffic.
   *
   * The exhaustive switch is load-bearing: adding a member to `HealthStatus`
   * without deciding what it means for routing will fail the build here.
   */
  static isServable(status: HealthStatus): boolean {
    switch (status) {
      case 'ok':
        return true;
      case 'degraded':
      case 'down':
        return false;
      default:
        return assertNever(status, 'Unhandled health status');
    }
  }

  private async probeDatabase(): Promise<DependencyHealth> {
    const startedAt = performance.now();

    try {
      await this.prisma.ping();
      return {
        name: 'postgresql',
        status: 'ok',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      // The underlying pg/Prisma driver's error message can embed
      // hostnames, usernames, or connection-string fragments — a public
      // readiness endpoint must never return that. The real error is
      // logged server-side (operators can read it there); the HTTP
      // response gets only the fixed, non-sensitive GENERIC_DATABASE_ERROR
      // string, regardless of what the driver actually said.
      this.logger.error(
        `Database readiness probe failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        name: 'postgresql',
        status: 'down',
        latencyMs: Math.round(performance.now() - startedAt),
        error: GENERIC_DATABASE_ERROR,
      };
    }
  }

  private buildReport(status: HealthStatus, dependencies: DependencyHealth[]): HealthReport {
    return {
      status,
      environment: this.configService.getOrThrow<AppEnvironment>('NODE_ENV'),
      version: this.configService.getOrThrow<string>('APP_VERSION'),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies,
    };
  }
}
