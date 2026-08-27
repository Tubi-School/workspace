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
import type { AttendanceWindowException, SessionRecording } from '../generated/prisma/client.js';
import { CreateLiveIntervalDto } from './dto/create-live-interval.dto.js';
import { CreateWindowExceptionDto } from './dto/create-window-exception.dto.js';
import { PublishRecordingDto } from './dto/publish-recording.dto.js';
import { LiveAttendanceIntervalService } from './live-attendance.service.js';
import { RecordingService } from './recording.service.js';
import { WindowExceptionService } from './window-exception.service.js';

/**
 * ADMIN-only operational endpoints: LIVE interval ingestion (the seam a
 * future Zoom adapter attaches to — Part E), recording publication (Part
 * F), and attendance-window exceptions (Part H). None of this is
 * learner-facing.
 */
@Controller('admin/sessions/:sessionId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AttendanceAdminController {
  constructor(
    private readonly liveAttendanceIntervalService: LiveAttendanceIntervalService,
    private readonly recordingService: RecordingService,
    private readonly windowExceptionService: WindowExceptionService,
  ) {}

  @Post('live-intervals')
  @HttpCode(HttpStatus.CREATED)
  async ingestLiveInterval(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateLiveIntervalDto,
  ): Promise<void> {
    await this.liveAttendanceIntervalService.ingest(sessionId, dto);
  }

  @Post('recording')
  @HttpCode(HttpStatus.CREATED)
  publishRecording(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: PublishRecordingDto,
  ): Promise<SessionRecording> {
    return this.recordingService.publish(sessionId, dto);
  }

  @Get('window-exceptions')
  listWindowExceptions(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<AttendanceWindowException[]> {
    return this.windowExceptionService.findForSession(sessionId);
  }

  @Post('window-exceptions')
  @HttpCode(HttpStatus.CREATED)
  createWindowException(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateWindowExceptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendanceWindowException> {
    return this.windowExceptionService.create(sessionId, dto, user.id);
  }
}
