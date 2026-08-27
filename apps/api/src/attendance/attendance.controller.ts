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

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthenticatedUser } from '../auth/types.js';
import type { AttendanceRecord } from '../generated/prisma/client.js';
import {
  AttendanceService,
  type AttendanceRecordWithLearner,
  type CoverageSummary,
} from './attendance.service.js';
import { OverrideAttendanceDto } from './dto/override-attendance.dto.js';

/**
 * ADMIN (school-wide) and TEACHER (assignment-scoped) attendance reads,
 * manual override, and finalization (Parts I, K, L). Learner self-service
 * reads live in the learner-portal module — a learner's identity there is
 * always derived from the token, never from a path parameter.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('admin/attendance/sessions/:sessionId')
  @Roles('ADMIN')
  getSessionAttendance(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<AttendanceRecordWithLearner[]> {
    return this.attendanceService.getSessionAttendance(sessionId);
  }

  @Get('admin/attendance/learners/:learnerId')
  @Roles('ADMIN')
  getLearnerAttendanceHistory(
    @Param('learnerId', ParseUUIDPipe) learnerId: string,
  ): Promise<AttendanceRecord[]> {
    return this.attendanceService.getLearnerAttendanceHistory(learnerId);
  }

  @Get('admin/attendance/sessions/:sessionId/learners/:learnerId/coverage')
  @Roles('ADMIN')
  getCoverage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('learnerId', ParseUUIDPipe) learnerId: string,
  ): Promise<CoverageSummary> {
    return this.attendanceService.getCoverageSummary(sessionId, learnerId);
  }

  @Post('admin/attendance/:attendanceRecordId/override')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  override(
    @Param('attendanceRecordId', ParseUUIDPipe) attendanceRecordId: string,
    @Body() dto: OverrideAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendanceRecord> {
    return this.attendanceService.override(attendanceRecordId, dto, user.id);
  }

  /** Controlled, idempotent, callable manually now; the exact seam a
   * future scheduler invokes on a timer (Part I). */
  @Post('admin/attendance/finalize')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  finalize(): Promise<{ finalizedCount: number }> {
    return this.attendanceService.finalizeDueRecords();
  }

  @Get('teacher/attendance/sessions/:sessionId')
  @Roles('TEACHER')
  async getSessionAttendanceForTeacher(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendanceRecordWithLearner[]> {
    await this.attendanceService.assertTeacherAssignedToSession(user.id, sessionId);
    return this.attendanceService.getSessionAttendance(sessionId);
  }
}
