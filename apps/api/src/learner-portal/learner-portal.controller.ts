import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AttendanceService, type CoverageSummary } from '../attendance/attendance.service.js';
import { CreateWatchedIntervalDto } from '../attendance/dto/create-watched-interval.dto.js';
import { WatchedIntervalService } from '../attendance/watched-interval.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthenticatedUser } from '../auth/types.js';
import type { AttendanceRecord } from '../generated/prisma/client.js';
import { LearnerPortalService, type LearnerVisibleSession } from './learner-portal.service.js';

@Controller('learner')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LEARNER')
export class LearnerPortalController {
  constructor(
    private readonly learnerPortalService: LearnerPortalService,
    private readonly attendanceService: AttendanceService,
    private readonly watchedIntervalService: WatchedIntervalService,
  ) {}

  @Get('sessions')
  async listSessions(@CurrentUser() user: AuthenticatedUser): Promise<LearnerVisibleSession[]> {
    const learnerId = await this.learnerPortalService.resolveLearnerProfileId(user.id);
    return this.learnerPortalService.listEntitledSessions(learnerId);
  }

  @Get('sessions/:id')
  async getSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LearnerVisibleSession> {
    const learnerId = await this.learnerPortalService.resolveLearnerProfileId(user.id);
    return this.learnerPortalService.getEntitledSession(learnerId, id);
  }

  @Get('sessions/:id/attendance')
  async getAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttendanceRecord & CoverageSummary> {
    const learnerId = await this.learnerPortalService.resolveLearnerProfileId(user.id);
    // Same "not entitled reads as 404" rule as every other learner-facing
    // route here — never a 403 that would confirm the session exists to a
    // caller with no relationship to it.
    await this.learnerPortalService.getEntitledSession(learnerId, id);
    const record = await this.attendanceService.getOneAttendanceRecord(id, learnerId);
    const coverage = await this.attendanceService.getCoverageSummary(id, learnerId);
    return { ...record, ...coverage };
  }

  @Post('sessions/:id/recording/watched-intervals')
  @HttpCode(HttpStatus.CREATED)
  async ingestWatchedInterval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWatchedIntervalDto,
  ): Promise<void> {
    const learnerId = await this.learnerPortalService.resolveLearnerProfileId(user.id);
    await this.watchedIntervalService.ingest(id, learnerId, dto);
  }
}
