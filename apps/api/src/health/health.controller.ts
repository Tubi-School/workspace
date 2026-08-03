import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import type { HealthReport } from '@tubi/types';

import { HealthService } from './health.service.js';

/**
 * Platform health endpoints.
 *
 * These exist for the deployment platform, not for the product: Railway polls
 * them to decide whether a container is alive and whether it should receive
 * traffic.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(200)
  getLiveness(): HealthReport {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  async getReadiness(): Promise<HealthReport> {
    const report = await this.healthService.getReadiness();

    // A readiness probe communicates through the status code, so a degraded
    // dependency must not return 200 even though the body is well-formed.
    if (!HealthService.isServable(report.status)) {
      throw new ServiceUnavailableException(report);
    }

    return report;
  }
}
